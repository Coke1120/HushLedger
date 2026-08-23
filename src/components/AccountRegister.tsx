import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  Circle,
  CircleCheck,
  Download,
  Landmark,
  LoaderCircle,
  ReceiptText,
  Scale,
} from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import { visibleAccountRegisterEntries } from '../lib/accountRegister'
import {
  accountRegisterExportCanStart,
  accountRegisterExportIsCurrent,
} from '../lib/accountRegisterExport'
import {
  accountUnclearedReviewContext,
  accountUnclearedReviewIsCurrent,
  parseAccountUnclearedReview,
} from '../lib/accountRegisterReview'
import { api } from '../lib/api'
import { isValidCalendarDate } from '../lib/date'
import { formatSignedAmountInput, parseSignedAmount } from '../lib/money'
import { calculateReconciliationDifference } from '../lib/reconciliation'
import type { SupportedCurrency } from '../lib/currency'
import type {
  AccountRegister as AccountRegisterData,
  AccountRegisterClearingInput,
  AccountTransfer,
  AccountUnclearedReview,
  Transaction,
} from '../lib/schema'

type AccountRegisterProps = {
  accountId: number
  currency: SupportedCurrency
  register: AccountRegisterData | null
  canExport: boolean
  snapshotVersion: number
  dateFrom: string
  dateTo: string
  transactions: Transaction[]
  transfers: AccountTransfer[]
  loading: boolean
  saving: boolean
  reconcileInitially: boolean
  initialStatementBalanceMinor?: number | null
  onClose: () => void
  onDateRangeChange: (dateFrom: string, dateTo: string) => void
  onEditTransaction: (transaction: Transaction) => void
  onEditTransfer: (transfer: AccountTransfer) => void
  onSetEntryCleared: (input: AccountRegisterClearingInput) => Promise<boolean>
}

type LoadedUnclearedReview = {
  context: string
  data: AccountUnclearedReview
}

export function AccountRegister({
  accountId,
  currency,
  register,
  canExport,
  snapshotVersion,
  dateFrom,
  dateTo,
  transactions,
  transfers,
  loading,
  saving,
  reconcileInitially,
  initialStatementBalanceMinor = null,
  onClose,
  onDateRangeChange,
  onEditTransaction,
  onEditTransfer,
  onSetEntryCleared,
}: AccountRegisterProps) {
  const { formatDate, formatMoney, locale, localizeEntityName, privacyMode, t } = useI18n()
  const [reconciling, setReconciling] = useState(reconcileInitially)
  const [showUnclearedOnly, setShowUnclearedOnly] = useState(reconcileInitially)
  const [statementValue, setStatementValue] = useState(() => (
    initialStatementBalanceMinor === null
      ? ''
      : formatSignedAmountInput(initialStatementBalanceMinor, locale)
  ))
  const [rangeDraft, setRangeDraft] = useState({ dateFrom, dateTo })
  const [updatingEntryId, setUpdatingEntryId] = useState<string | null>(null)
  const [exportState, setExportState] = useState<'idle' | 'preparing' | 'ready' | 'error'>('idle')
  const [reviewState, setReviewState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [loadedReview, setLoadedReview] = useState<LoadedUnclearedReview | null>(null)
  const [reviewReloadNonce, setReviewReloadNonce] = useState(0)
  const unclearedFilterRef = useRef<HTMLInputElement>(null)
  const exportRequestIdRef = useRef(0)
  const exportControllerRef = useRef<AbortController | null>(null)
  const reviewRequestIdRef = useRef(0)
  const reviewControllerRef = useRef<AbortController | null>(null)
  const handledReviewReloadNonceRef = useRef(0)
  const transactionsById = useMemo(
    () => new Map(transactions.map((transaction) => [transaction.id, transaction])),
    [transactions],
  )
  const transfersById = useMemo(
    () => new Map(transfers.map((transfer) => [transfer.id, transfer])),
    [transfers],
  )
  const rangeReady = register?.accountId === accountId
    && register.dateFrom === dateFrom
    && register.dateTo === dateTo
  const rangeRegister = rangeReady ? register : null
  const validRange = isValidCalendarDate(rangeDraft.dateFrom)
    && isValidCalendarDate(rangeDraft.dateTo)
    && rangeDraft.dateFrom <= rangeDraft.dateTo
  const rangeChanged = rangeDraft.dateFrom !== dateFrom || rangeDraft.dateTo !== dateTo
  const reviewContext = accountUnclearedReviewContext({
    accountId,
    dateFrom,
    dateTo,
    draftDateFrom: rangeDraft.dateFrom,
    draftDateTo: rangeDraft.dateTo,
    available: canExport,
    snapshotVersion,
  })
  const reviewContextRef = useRef(reviewContext)
  const completeReview = loadedReview?.context === reviewContext ? loadedReview.data : null
  const exporting = exportState === 'preparing'
  const exportAvailable = accountRegisterExportCanStart({
    canExport,
    rangeReady,
    rangeChanged,
    saving,
  })
  const exportContext = [
    accountId,
    dateFrom,
    dateTo,
    rangeDraft.dateFrom,
    rangeDraft.dateTo,
    canExport ? 'online' : 'unavailable',
  ].join(':')
  const exportContextRef = useRef(exportContext)
  const cutoffBalances = completeReview ?? rangeRegister
  const clearedBalance = cutoffBalances?.clearedEndingBalanceMinor
  const exportStatus = exportState === 'preparing'
    ? t('exportCsvPreparing')
    : exportState === 'ready'
      ? t('exportCsvReady')
      : exportState === 'error'
        ? t('exportCsvFailed')
        : ''
  const statementResult = useMemo(() => {
    if (!statementValue.trim()) return null
    if (clearedBalance === null || clearedBalance === undefined) return null
    try {
      return calculateReconciliationDifference(
        parseSignedAmount(statementValue, locale),
        clearedBalance,
      )
    } catch {
      return undefined
    }
  }, [clearedBalance, locale, statementValue])
  useLayoutEffect(() => {
    exportContextRef.current = exportContext
    const resetStatus = window.setTimeout(() => setExportState('idle'), 0)
    return () => {
      window.clearTimeout(resetStatus)
      exportRequestIdRef.current += 1
      exportControllerRef.current?.abort()
      exportControllerRef.current = null
    }
  }, [exportContext])
  useLayoutEffect(() => {
    reviewContextRef.current = reviewContext
    const resetReview = window.setTimeout(() => {
      reviewRequestIdRef.current += 1
      reviewControllerRef.current?.abort()
      reviewControllerRef.current = null
      setLoadedReview(null)
      setReviewState('idle')
    }, 0)
    return () => {
      window.clearTimeout(resetReview)
      reviewRequestIdRef.current += 1
      reviewControllerRef.current?.abort()
      reviewControllerRef.current = null
    }
  }, [reviewContext])
  const cancelExport = () => {
    exportRequestIdRef.current += 1
    exportControllerRef.current?.abort()
    exportControllerRef.current = null
    setExportState('idle')
  }
  const cancelCompleteReview = () => {
    reviewRequestIdRef.current += 1
    reviewControllerRef.current?.abort()
    reviewControllerRef.current = null
    setLoadedReview(null)
    setReviewState('idle')
  }
  const toggleReconciliation = () => {
    const next = !reconciling
    if (!next) cancelCompleteReview()
    setReconciling(next)
    setShowUnclearedOnly(next)
  }
  const closeRegister = () => {
    cancelCompleteReview()
    onClose()
  }
  const applyDateRange = () => {
    if (!validRange || !rangeChanged || saving) return
    if (rangeDraft.dateTo !== dateTo) setStatementValue('')
    cancelExport()
    cancelCompleteReview()
    onDateRangeChange(rangeDraft.dateFrom, rangeDraft.dateTo)
  }
  const loadCompleteReview = useCallback(async () => {
    if (!canExport || !rangeReady || rangeChanged || saving || reviewState === 'loading') return
    const requestId = ++reviewRequestIdRef.current
    reviewControllerRef.current?.abort()
    const controller = new AbortController()
    reviewControllerRef.current = controller
    const requestContext = reviewContext
    setLoadedReview(null)
    setReviewState('loading')
    try {
      const payload = await api<unknown>('/api/accounts/register/uncleared', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId, dateTo }),
        signal: controller.signal,
      })
      if (!accountUnclearedReviewIsCurrent({
        requestId,
        activeRequestId: reviewRequestIdRef.current,
        requestContext,
        activeContext: reviewContextRef.current,
        aborted: controller.signal.aborted,
      })) return
      const review = parseAccountUnclearedReview(payload, { accountId, dateTo })
      if (!review) throw new Error('Incomplete uncleared account review')
      setLoadedReview({ context: requestContext, data: review })
      setReviewState('ready')
    } catch {
      if (!accountUnclearedReviewIsCurrent({
        requestId,
        activeRequestId: reviewRequestIdRef.current,
        requestContext,
        activeContext: reviewContextRef.current,
        aborted: controller.signal.aborted,
      })) return
      setLoadedReview(null)
      setReviewState('error')
    } finally {
      if (requestId === reviewRequestIdRef.current) reviewControllerRef.current = null
    }
  }, [accountId, canExport, dateTo, rangeChanged, rangeReady, reviewContext, reviewState, saving])
  useEffect(() => {
    if (reviewReloadNonce === handledReviewReloadNonceRef.current
      || reviewState !== 'idle'
      || !canExport
      || !rangeReady
      || rangeChanged
      || saving) return
    handledReviewReloadNonceRef.current = reviewReloadNonce
    void loadCompleteReview()
  }, [
    canExport,
    loadCompleteReview,
    rangeChanged,
    rangeReady,
    reviewReloadNonce,
    reviewState,
    saving,
  ])
  const exportRegister = async () => {
    if (!exportAvailable || exporting) return
    const requestId = ++exportRequestIdRef.current
    exportControllerRef.current?.abort()
    const controller = new AbortController()
    exportControllerRef.current = controller
    const requestContext = exportContext
    setExportState('preparing')
    try {
      const response = await fetch('/api/exports/account-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId, dateFrom, dateTo }),
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal,
      })
      const contentType = response.headers.get('content-type') ?? ''
      if (!response.ok || !/^text\/csv(?:;|$)/i.test(contentType)) {
        throw new Error('Account-register export failed')
      }

      const blob = await response.blob()
      if (!accountRegisterExportIsCurrent({
        requestId,
        activeRequestId: exportRequestIdRef.current,
        requestContext,
        activeContext: exportContextRef.current,
        aborted: controller.signal.aborted,
      })) return

      const objectUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = accountRegisterExportFileName(
        response.headers.get('content-disposition'),
      )
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
      setExportState('ready')
    } catch {
      if (!accountRegisterExportIsCurrent({
        requestId,
        activeRequestId: exportRequestIdRef.current,
        requestContext,
        activeContext: exportContextRef.current,
        aborted: controller.signal.aborted,
      })) return
      setExportState('error')
    } finally {
      if (requestId === exportRequestIdRef.current) exportControllerRef.current = null
    }
  }

  const accountSnapshotLoading = Boolean(register && register.accountId !== accountId)
  if (loading || !register || accountSnapshotLoading) {
    return (
      <section className="account-register" aria-busy="true">
        <button className="button button-secondary account-register-back" type="button" onClick={closeRegister} disabled={saving}>
          <ArrowLeft aria-hidden="true" />
          {t('backToTransactions')}
        </button>
        <p className="account-register-empty" role="status">
          {t(loading || accountSnapshotLoading ? 'accountRegisterLoading' : 'demoMoneyData')}
        </p>
      </section>
    )
  }

  const accountName = localizeEntityName(register.accountName, register.accountLocalizationKey)
  const reconciliationAvailable = clearedBalance !== null && clearedBalance !== undefined
  const reconciliationOpen = reconciling
  const filterUncleared = reconciliationOpen && showUnclearedOnly
  const rangeEntries = rangeRegister?.entries ?? []
  const unclearedEntries = visibleAccountRegisterEntries(rangeEntries, true)
  const visibleEntries = filterUncleared && completeReview
    ? completeReview.entries
    : visibleAccountRegisterEntries(rangeEntries, filterUncleared)
  const filteredEmpty = filterUncleared && visibleEntries.length === 0
  const unclearedCount = completeReview?.unclearedCount ?? rangeRegister?.unclearedCount ?? 0
  const setEntryCleared = async (
    entry: AccountRegisterData['entries'][number],
    cleared: boolean,
  ) => {
    if (saving
      || updatingEntryId !== null
      || entry.kind === 'opening'
      || !entry.sourceId
      || !entry.updatedAt) return
    const reloadCompleteReview = completeReview !== null
    setUpdatingEntryId(entry.entryId)
    try {
      const updated = await onSetEntryCleared({
        accountId: register.accountId,
        kind: entry.kind,
        sourceId: entry.sourceId,
        updatedAt: entry.updatedAt,
        cleared,
      })
      if (reloadCompleteReview) {
        cancelCompleteReview()
        if (updated) setReviewReloadNonce((current) => current + 1)
      }
      if (updated && cleared) {
        requestAnimationFrame(() => {
          const filter = unclearedFilterRef.current
          if (filter?.checked) filter.focus()
        })
      }
    } finally {
      setUpdatingEntryId(null)
    }
  }

  return (
    <section className="account-register" aria-labelledby="account-register-title">
      <button className="button button-secondary account-register-back" type="button" onClick={closeRegister} disabled={saving}>
        <ArrowLeft aria-hidden="true" />
        {t('backToTransactions')}
      </button>

      <header className="account-register-heading">
        <span aria-hidden="true"><Landmark /></span>
        <div>
          <h2 id="account-register-title">{t('accountRegisterTitle', { account: accountName })}</h2>
          <p>{t('accountRegisterHelp', {
            from: formatDate(dateFrom),
            to: formatDate(dateTo),
          })}</p>
          <p className="account-register-export-help" id="account-register-export-help">
            {t('exportAccountRegisterCsvHelp')}
          </p>
        </div>
        <div className="account-register-heading-actions">
          <button
            className="button button-secondary account-register-export"
            type="button"
            onClick={() => void exportRegister()}
            disabled={!exportAvailable || exporting}
            aria-describedby="account-register-export-help account-register-export-status"
            title={t(
              !canExport || !rangeReady
                ? 'exportAccountRegisterCsvUnavailable'
                : rangeChanged
                  ? 'exportAccountRegisterCsvApplyRange'
                  : 'exportAccountRegisterCsvHelp',
            )}
          >
            <Download aria-hidden="true" />
            {exporting ? t('exportCsvPreparing') : t('exportAccountRegisterCsv')}
          </button>
          <button
            className="button button-secondary account-register-reconcile-toggle"
            type="button"
            onClick={toggleReconciliation}
            disabled={saving}
            aria-expanded={reconciliationOpen}
            aria-controls="account-reconciliation"
          >
            <Scale aria-hidden="true" />
            {t(reconciliationOpen ? 'closeStatementComparison' : 'compareStatement')}
          </button>
        </div>
      </header>
      <p
        id="account-register-export-status"
        className={`account-register-export-status${exportState === 'error' ? ' is-error' : ''}`}
        aria-live="polite"
        aria-atomic="true"
      >
        {exportStatus}
      </p>

      <dl className="account-register-summary">
        <div>
          <dt>{t('accountRegisterStartingBalance')}</dt>
          <dd>{!rangeRegister
            ? t('accountRegisterLoading')
            : rangeRegister.startingBalanceMinor === null
              ? t('accountRegisterUnavailable')
              : formatMoney(rangeRegister.startingBalanceMinor, currency)}
          </dd>
        </div>
        <div>
          <dt>{t('accountRegisterEndingBalance')}</dt>
          <dd>{!rangeRegister
            ? t('accountRegisterLoading')
            : rangeRegister.endingBalanceMinor === null
              ? t('accountRegisterUnavailable')
              : formatMoney(rangeRegister.endingBalanceMinor, currency)}
          </dd>
        </div>
        <div>
          <dt>{t('accountRegisterEntries')}</dt>
          <dd>{rangeRegister?.entryCount ?? t('accountRegisterLoading')}</dd>
        </div>
      </dl>

      {reconciliationOpen ? (
        <section className="account-reconciliation" id="account-reconciliation" aria-labelledby="account-reconciliation-title">
          <header>
            <div>
              <h3 id="account-reconciliation-title">{t('reconciliationTitle')}</h3>
              <p>{t('reconciliationHelp')}</p>
            </div>
            <span>{t('reconciliationLocalOnly')}</span>
          </header>
          <form
            className="account-reconciliation-range"
            onSubmit={(event) => {
              event.preventDefault()
              applyDateRange()
            }}
          >
            <label>
              <span>{t('statementPeriodStartsOn')}</span>
              <input
                type="date"
                value={rangeDraft.dateFrom}
                onChange={(event) => {
                  cancelExport()
                  cancelCompleteReview()
                  setRangeDraft((current) => ({
                    ...current,
                    dateFrom: event.target.value,
                  }))
                }}
              />
            </label>
            <label>
              <span>{t('statementClosesOn')}</span>
              <input
                type="date"
                value={rangeDraft.dateTo}
                onChange={(event) => {
                  const nextDateTo = event.target.value
                  cancelExport()
                  cancelCompleteReview()
                  setRangeDraft((current) => ({ ...current, dateTo: nextDateTo }))
                  if (nextDateTo !== dateTo) setStatementValue('')
                }}
              />
            </label>
            <button
              className="button button-secondary"
              type="submit"
              disabled={!validRange || !rangeChanged || saving}
            >
              {t('applyStatementPeriod')}
            </button>
          </form>
          <p className="account-reconciliation-range-help">{t('statementPeriodHelp')}</p>
          {!rangeReady ? (
            <p className="account-reconciliation-status" role="status">{t('accountRegisterLoading')}</p>
          ) : reconciliationAvailable && rangeRegister ? (
            <>
              <dl className="account-reconciliation-balances">
                <div>
                  <dt>{t('recordedBalance')}</dt>
                  <dd>{formatMoney(cutoffBalances?.endingBalanceMinor ?? 0, currency)}</dd>
                </div>
                <div>
                  <dt>{t('clearedBalance')}</dt>
                  <dd>{formatMoney(cutoffBalances?.clearedEndingBalanceMinor ?? 0, currency)}</dd>
                </div>
                <div>
                  <dt>{t('unclearedBalance')}</dt>
                  <dd>{formatMoney(cutoffBalances?.unclearedEndingBalanceMinor ?? 0, currency)}</dd>
                </div>
              </dl>
              <div className="statement-comparison">
                <label>
                  <span>{t('statementEndingBalance')}</span>
                  <input
                    type={privacyMode ? 'password' : 'text'}
                    inputMode="decimal"
                    value={statementValue}
                    onChange={(event) => setStatementValue(event.target.value)}
                    placeholder={t('statementBalancePlaceholder')}
                    autoComplete="off"
                    autoFocus
                  />
                </label>
                <div className="statement-comparison-result" aria-live="polite">
                  {statementResult === undefined ? (
                    <span className="is-error">{t('invalidStatementBalance')}</span>
                  ) : statementResult === null ? (
                    <span>{t('statementComparisonHelp')}</span>
                  ) : statementResult === 0 ? (
                    <strong className="is-match">{t('statementBalancesMatch')}</strong>
                  ) : (
                    <strong>{t('statementDifference', { amount: formatMoney(statementResult, currency) })}</strong>
                  )}
                </div>
              </div>
              <div className="account-reconciliation-review">
                <div className="account-reconciliation-review-copy">
                  <p id="account-reconciliation-review" aria-live="polite">
                    {completeReview
                      ? t('reconciliationReviewComplete', {
                          count: unclearedCount,
                          date: formatDate(completeReview.dateTo),
                        })
                      : t(
                          rangeRegister.unclearedCount === null
                            || rangeRegister.entryCount > rangeRegister.entries.length
                            || (rangeRegister.unclearedCount ?? 0) > unclearedEntries.length
                            ? 'reconciliationReviewHelpLimited'
                            : 'reconciliationReviewHelp',
                          {
                            count: rangeRegister.unclearedCount ?? 0,
                            loaded: rangeRegister.entries.length,
                            total: rangeRegister.entryCount,
                            visible: visibleEntries.length,
                          },
                        )}
                  </p>
                  {completeReview
                    || reviewState === 'loading'
                    || reviewState === 'error'
                    || rangeRegister.unclearedCount === null
                    || rangeRegister.entryCount > rangeRegister.entries.length
                    || (rangeRegister.unclearedCount ?? 0) > unclearedEntries.length ? (
                      <div className="account-reconciliation-complete-review">
                        <p id="account-reconciliation-complete-review-privacy">
                          {t('completeUnclearedReviewPrivacy')}
                        </p>
                        <button
                          className="button button-secondary"
                          type="button"
                          disabled={!canExport || !rangeReady || rangeChanged || saving || reviewState === 'loading'}
                          aria-busy={reviewState === 'loading'}
                          aria-describedby="account-reconciliation-complete-review-privacy account-reconciliation-complete-review-status"
                          onClick={() => void loadCompleteReview()}
                        >
                          {t(reviewState === 'loading'
                            ? 'loadingCompleteUnclearedReview'
                            : reviewState === 'error'
                              ? 'retryCompleteUnclearedReview'
                              : completeReview
                                ? 'reloadCompleteUnclearedReview'
                                : 'loadCompleteUnclearedReview')}
                        </button>
                        <span
                          id="account-reconciliation-complete-review-status"
                          className={reviewState === 'error' ? 'is-error' : ''}
                          role="status"
                        >
                          {reviewState === 'error' ? t('completeUnclearedReviewFailed') : ''}
                        </span>
                      </div>
                    ) : null}
                </div>
                <label className="account-reconciliation-filter">
                  <input
                    ref={unclearedFilterRef}
                    type="checkbox"
                    checked={filterUncleared}
                    aria-controls="account-register-results"
                    aria-describedby="account-reconciliation-review"
                    onChange={(event) => setShowUnclearedOnly(event.target.checked)}
                  />
                  <span>{t('showUnclearedRegisterEntriesOnly')}</span>
                </label>
              </div>
            </>
          ) : (
            <p className="account-reconciliation-status" role="status">
              {t('accountRegisterUnavailable')}
            </p>
          )}
        </section>
      ) : null}

      {cutoffBalances?.availableFrom ? (
        <p className="account-register-boundary">
          {t('accountRegisterAvailableFrom', { date: formatDate(cutoffBalances.availableFrom) })}
        </p>
      ) : null}

      {!rangeReady ? (
        <p className="account-register-empty" id="account-register-results" role="status">
          {t('accountRegisterLoading')}
        </p>
      ) : visibleEntries.length === 0 ? (
        <div className="account-register-empty" id="account-register-results">
          <strong>{t(filteredEmpty
            ? completeReview ? 'noUnclearedReviewEntries' : 'noUnclearedRegisterEntries'
            : 'accountRegisterEmpty')}
          </strong>
          <span>{t(filteredEmpty
            ? completeReview ? 'noUnclearedReviewEntriesHelp' : 'noUnclearedRegisterEntriesHelp'
            : 'accountRegisterEmptyHelp')}
          </span>
        </div>
      ) : (
        <ul className="account-register-list" id="account-register-results" aria-label={t('accountRegisterList')}>
          {visibleEntries.map((entry) => {
            const transaction = entry.kind === 'transaction' && entry.sourceId
              ? transactionsById.get(entry.sourceId)
              : undefined
            const transfer = entry.kind === 'transfer' && entry.sourceId
              ? transfersById.get(entry.sourceId)
              : undefined
            const categoryName = entry.categoryName
              ? localizeEntityName(entry.categoryName, entry.categoryLocalizationKey)
              : ''
            const counterparty = entry.counterpartyAccountName
              ? localizeEntityName(
                  entry.counterpartyAccountName,
                  entry.counterpartyAccountLocalizationKey,
                )
              : ''
            const title = entry.kind === 'opening'
              ? t('accountRegisterOpeningBalance')
              : entry.kind === 'transfer'
                ? t(entry.transferDirection === 'in' ? 'accountRegisterTransferIn' : 'accountRegisterTransferOut', {
                    account: counterparty,
                  })
                : entry.payee || categoryName
            const editable = Boolean(transaction || transfer)
            const canClear = entry.kind !== 'opening'
              && entry.cleared !== null
              && Boolean(entry.sourceId && entry.updatedAt)
            const amountSign = entry.amountMinor > 0 ? '+' : entry.amountMinor < 0 ? '−' : ''
            const Icon = entry.kind === 'opening'
              ? Landmark
              : entry.transferDirection === 'in'
                ? ArrowDownLeft
                : entry.transferDirection === 'out'
                  ? ArrowUpRight
                  : ReceiptText

            const content = (
              <>
                <span className={`account-register-icon ${entry.kind}`} aria-hidden="true"><Icon /></span>
                <span className="account-register-main">
                  <strong>{title}</strong>
                  {entry.kind === 'transaction' ? <small><span>{categoryName}</span></small> : null}
                  {entry.note ? <span className="account-register-note">{entry.note}</span> : null}
                </span>
                <time dateTime={entry.occurredOn}>{formatDate(entry.occurredOn)}</time>
                <span className="account-register-money">
                  <strong className={entry.amountMinor >= 0 ? 'income' : 'expense'}>
                    {amountSign}{formatMoney(Math.abs(entry.amountMinor), currency)}
                  </strong>
                  <small>{t('accountRegisterRunningBalance', {
                    amount: formatMoney(entry.runningBalanceMinor, currency),
                  })}</small>
                </span>
              </>
            )

            return (
              <li key={entry.entryId}>
                {editable ? (
                  <button
                    className={`account-register-row${entry.cleared === false ? ' is-uncleared' : ''}`}
                    type="button"
                    disabled={saving}
                    onClick={() => transaction
                      ? onEditTransaction(transaction)
                      : transfer && onEditTransfer(transfer)}
                  >
                    <span className="sr-only">{t('edit')}</span>
                    {content}
                  </button>
                ) : (
                  <div className="account-register-row">{content}</div>
                )}
                {canClear ? (
                  <button
                    className={`account-register-clearing-toggle ${entry.cleared ? 'is-cleared' : 'is-uncleared'}`}
                    type="button"
                    disabled={saving || updatingEntryId !== null || reviewState === 'loading'}
                    aria-busy={updatingEntryId === entry.entryId}
                    aria-label={t(entry.cleared
                      ? 'markRegisterEntryUncleared'
                      : 'markRegisterEntryCleared')}
                    title={t(entry.cleared
                      ? 'markRegisterEntryUncleared'
                      : 'markRegisterEntryCleared')}
                    onClick={() => void setEntryCleared(entry, !entry.cleared)}
                  >
                    {updatingEntryId === entry.entryId
                      ? <LoaderCircle className="spin" aria-hidden="true" />
                      : entry.cleared
                        ? <CircleCheck aria-hidden="true" />
                        : <Circle aria-hidden="true" />}
                    <span>{t(entry.cleared ? 'cleared' : 'uncleared')}</span>
                  </button>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}

      {rangeRegister
        && !(filterUncleared && completeReview)
        && rangeRegister.entryCount > rangeRegister.entries.length ? (
        <p className="account-register-limit">
          {t('accountRegisterLimit', {
            shown: rangeRegister.entries.length,
            total: rangeRegister.entryCount,
          })}
        </p>
      ) : null}
    </section>
  )
}

function accountRegisterExportFileName(contentDisposition: string | null) {
  return contentDisposition?.match(/filename="([^"]+)"/)?.[1]
    ?? 'hushledger-account-register.csv'
}
