import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createAccountTransferAction,
  createTransactionAction,
  deleteAccountTransferAction,
  deleteTransactionAction,
  setAccountRegisterEntryClearingAction,
  setTransactionsCategoryAction,
  setTransactionsClearingAction,
  setTransactionsImportReviewStatusAction,
  updateAccountTransferAction,
  updateTransactionAction,
} from '../app/actions'
import { message, messageForError, renderMessage, useI18n, type LocalizedMessage } from '../i18n'
import { ApiError, api } from '../lib/api'
import type { LedgerCurrencySettings } from '../lib/currency'
import {
  addDemo,
  deleteDemo,
  demoSummary,
  getDemoTransactions,
  setDemoTransactionsCategory,
  setDemoTransactionsClearing,
  summarizeDemoTransactions,
  updateDemo,
} from '../lib/demo'
import { buildDemoSnapshot, type DemoSnapshot } from '../lib/demoSnapshot'
import type {
  Account,
  AccountBalance,
  AccountRegister,
  AccountRegisterClearingInput,
  AccountTransfer,
  AccountTransferInput,
  Category,
  EmergencyFundGoal,
  ImportReviewStatus,
  NetWorthTrendPoint,
  Summary,
  Transaction,
  TransactionClearingStatus,
  TransactionDateScope,
  TransactionInput,
  TransactionPageCursor,
  TransactionSort,
  TransactionType,
} from '../lib/schema'
import {
  isValidInitialTransactionPage,
  mergeTransactionContinuation,
  type InitialTransactionPage,
  type TransactionContinuationPage,
} from '../lib/transactionPagination'
import { transactionQueryFromFilters } from '../lib/transactionQuery'
import { actionData } from './actionResult'
import { subscribeToForegroundRefresh } from './foregroundRefresh'

export type DataSource = 'loading' | 'live' | 'demo' | 'error'
export type RefreshFailureMode = 'demo' | 'error' | 'preserve'

type Snapshot = DemoSnapshot

type TransactionQueryResult = InitialTransactionPage

type TransactionContinuationResult = TransactionContinuationPage

type TransactionPageState = {
  nextCursor: TransactionPageCursor | null
  loading: boolean
  error: LocalizedMessage | null
  loadedMore: boolean
  refreshRequired: boolean
}

const emptyTransactionPage = (): TransactionPageState => ({
  nextCursor: null,
  loading: false,
  error: null,
  loadedMore: false,
  refreshRequired: false,
})

export function useMoneyData(
  month: string,
  type: TransactionType | 'all',
  search: string,
  accountId: number | null,
  categoryId: number | null,
  payee: string | null,
  tag: string | null,
  status: TransactionClearingStatus | 'all',
  importReviewStatus: ImportReviewStatus | 'all',
  sort: TransactionSort,
  duplicatesOnly: boolean,
  scope: TransactionDateScope,
  dateFrom: string,
  dateTo: string,
  registerAccountId: number | null,
  amountMinor: number | null = null,
) {
  const { setLedgerCurrency, t } = useI18n()
  const [snapshot, setSnapshot] = useState<Snapshot>(() => (
    buildDemoSnapshot(
      month, type, search, accountId, categoryId, payee, tag, status, sort, duplicatesOnly, scope,
      dateFrom, dateTo, amountMinor, undefined, importReviewStatus,
    )
  ))
  const [source, setSource] = useState<DataSource>('loading')
  const [online, setOnline] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<LocalizedMessage | null>(null)
  const [actionMessage, setActionMessage] = useState<LocalizedMessage | null>(null)
  const [transactionPage, setTransactionPage] = useState<TransactionPageState>(emptyTransactionPage)
  const [snapshotVersion, setSnapshotVersion] = useState(0)
  const requestSequence = useRef(0)
  const submitting = useRef(false)
  const loadingMore = useRef(false)
  const recoveringTransactionPage = useRef(false)

  const transactionQuery = useMemo(() => transactionQueryFromFilters({
    month,
    scope,
    dateFrom,
    dateTo,
    type,
    status,
    importReviewStatus,
    accountId: registerAccountId ?? accountId,
    categoryId,
    amountMinor,
    payee,
    search,
    tag,
    duplicatesOnly,
    sort,
  }), [accountId, amountMinor, categoryId, dateFrom, dateTo, duplicatesOnly, importReviewStatus, month, payee, registerAccountId, scope, search, sort, status, tag, type])

  const fetchSnapshot = useCallback(async (): Promise<{
    snapshot: Snapshot
    nextCursor: TransactionPageCursor | null
  }> => {
    const effectiveAccountId = registerAccountId ?? accountId
    const transferQuery = registerAccountId === null
      ? new URLSearchParams({ month })
      : new URLSearchParams({ dateFrom, dateTo })
    if (effectiveAccountId !== null) transferQuery.set('accountId', String(effectiveAccountId))
    const registerQuery = new URLSearchParams({ dateFrom, dateTo })
    if (registerAccountId !== null) registerQuery.set('accountId', String(registerAccountId))

    const [
      transactionResult,
      accountTransfers,
      accountBalances,
      accountRegister,
      netWorthTrend,
      summary,
      accounts,
      categories,
      emergencyFundGoal,
      ledgerSettings,
    ] = await Promise.all([
      api<TransactionQueryResult>('/api/transactions/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(transactionQuery),
      }),
      api<AccountTransfer[]>(`/api/transfers?${transferQuery}`),
      api<AccountBalance[]>(`/api/accounts/balances?month=${encodeURIComponent(month)}`),
      registerAccountId === null
        ? Promise.resolve(null)
        : api<AccountRegister>(`/api/accounts/register?${registerQuery}`),
      api<NetWorthTrendPoint[]>(`/api/reports/net-worth?month=${encodeURIComponent(month)}`),
      api<Summary>(`/api/summary?month=${encodeURIComponent(month)}`),
      api<Account[]>('/api/accounts'),
      api<Category[]>('/api/categories'),
      api<EmergencyFundGoal | null>('/api/emergency-fund-goal'),
      api<LedgerCurrencySettings>('/api/ledger-settings'),
    ])
    if (!isValidInitialTransactionPage(transactionResult)) {
      throw new Error('Transaction page response is inconsistent')
    }
    return {
      snapshot: {
        reportMonth: month,
        transactions: transactionResult.transactions,
        accountTransfers,
        accountBalances,
        accountRegister,
        netWorthTrend,
        transactionFilterSummary: transactionResult.summary,
        summary,
        accounts,
        categories,
        emergencyFundGoal,
        ledgerSettings,
      },
      nextCursor: transactionResult.nextCursor,
    }
  }, [accountId, dateFrom, dateTo, month, registerAccountId, transactionQuery])

  const setDemoSnapshot = useCallback(() => {
    setSnapshot((current) => buildDemoSnapshot(
      month, type, search, accountId, categoryId, payee, tag, status, sort, duplicatesOnly, scope,
      dateFrom, dateTo, amountMinor, current.ledgerSettings.currency, importReviewStatus,
    ))
  }, [accountId, amountMinor, categoryId, dateFrom, dateTo, duplicatesOnly, importReviewStatus, month, payee, scope, search, sort, status, tag, type])

  const refresh = useCallback(
    async (failureMode: RefreshFailureMode = 'demo') => {
      const sequence = ++requestSequence.current
      setTransactionPage(emptyTransactionPage())
      if (failureMode !== 'preserve') setSaveError(null)

      if (!navigator.onLine) {
        setOnline(false)
        if (failureMode === 'demo') {
          setDemoSnapshot()
          setSource('demo')
        }
        return false
      }

      try {
        const next = await fetchSnapshot()
        if (sequence !== requestSequence.current) return false
        setLedgerCurrency(next.snapshot.ledgerSettings.currency)
        setSnapshot(next.snapshot)
        setTransactionPage({
          nextCursor: next.nextCursor,
          loading: false,
          error: null,
          loadedMore: false,
          refreshRequired: false,
        })
        setSnapshotVersion((current) => current + 1)
        setSource('live')
        setOnline(true)
        return true
      } catch {
        if (sequence !== requestSequence.current) return false
        if (failureMode === 'demo') {
          setDemoSnapshot()
          setSource('demo')
        } else if (failureMode === 'error') {
          setSource('error')
        }
        return false
      }
    },
    [fetchSnapshot, setDemoSnapshot, setLedgerCurrency],
  )

  useEffect(() => {
    const timeout = window.setTimeout(() => void refresh(), 0)
    return () => window.clearTimeout(timeout)
  }, [refresh])

  useEffect(() => subscribeToForegroundRefresh(
    document,
    () => source !== 'live' || !navigator.onLine || submitting.current,
    () => { void refresh('preserve') },
  ), [refresh, source])

  useEffect(() => {
    const handleOnline = () => {
      setOnline(true)
      void refresh()
    }
    const handleOffline = () => {
      requestSequence.current += 1
      setTransactionPage(emptyTransactionPage())
      setOnline(false)
      setDemoSnapshot()
      setSource('demo')
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [refresh, setDemoSnapshot])

  const recoverTransactionPage = useCallback(async () => {
    if (recoveringTransactionPage.current) return false
    recoveringTransactionPage.current = true
    try {
      const refreshPromise = refresh('preserve')
      const recoverySequence = requestSequence.current
      setTransactionPage((current) => ({
        ...current,
        loading: true,
        error: null,
        refreshRequired: true,
      }))
      const refreshed = await refreshPromise
      if (requestSequence.current !== recoverySequence) return false
      setTransactionPage((current) => ({
        ...current,
        loading: false,
        error: message(refreshed ? 'transactionPageChanged' : 'transactionLoadMoreFailed'),
        refreshRequired: !refreshed,
      }))
      return refreshed
    } finally {
      recoveringTransactionPage.current = false
    }
  }, [refresh])

  const loadMoreTransactions = useCallback(async () => {
    const cursor = transactionPage.nextCursor
    if (
      !cursor
      || transactionPage.loading
      || loadingMore.current
      || submitting.current
      || source !== 'live'
      || !online
    ) return false

    const sequence = requestSequence.current
    const currentTransactions = snapshot.transactions
    const total = snapshot.transactionFilterSummary.transactionCount
    loadingMore.current = true
    setTransactionPage((current) => (
      current.nextCursor === cursor
        ? { ...current, loading: true, error: null, refreshRequired: false }
        : current
    ))

    try {
      const page = await api<TransactionContinuationResult>('/api/transactions/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...transactionQuery, cursor }),
      })
      if (sequence !== requestSequence.current) return false

      const merged = mergeTransactionContinuation(currentTransactions, total, cursor, page)
      if (merged.kind === 'invalid') {
        await recoverTransactionPage()
        return false
      }

      setSnapshot((current) => ({ ...current, transactions: merged.transactions }))
      setTransactionPage({
        nextCursor: merged.nextCursor,
        loading: false,
        error: null,
        loadedMore: true,
        refreshRequired: false,
      })
      return true
    } catch (error) {
      if (sequence !== requestSequence.current) return false
      if (error instanceof ApiError && error.code === 'TRANSACTION_CURSOR_STALE') {
        await recoverTransactionPage()
        return false
      }
      setTransactionPage((current) => (
        current.nextCursor === cursor
          ? {
              ...current,
              loading: false,
              error: message('transactionLoadMoreFailed'),
              refreshRequired: false,
            }
          : current
      ))
      return false
    } finally {
      loadingMore.current = false
    }
  }, [online, recoverTransactionPage, snapshot.transactionFilterSummary.transactionCount, snapshot.transactions, source, transactionPage.loading, transactionPage.nextCursor, transactionQuery])

  const saveTransaction = useCallback(
    async (input: TransactionInput, original?: Transaction) => {
      if (submitting.current) return false
      submitting.current = true
      setSaving(true)
      setSaveError(null)
      setActionMessage(null)

      try {
        if (!navigator.onLine) {
          setSaveError(message('transactionOfflineError'))
          return false
        }

        if (source === 'demo') {
          if (original) updateDemo(input)
          else addDemo(input)
          setDemoSnapshot()
          setActionMessage(message(original ? 'demoTransactionChanged' : 'demoTransactionSaved'))
          return true
        }

        if (original) {
          const { id, ...fields } = input
          await actionData(updateTransactionAction(id, { ...fields, updatedAt: original.updatedAt }))
        } else {
          await actionData(createTransactionAction(input))
        }
        const refreshed = await refresh('error')
        setActionMessage(
          message(
            refreshed
              ? original
                ? 'transactionUpdated'
                : 'transactionSaved'
              : 'transactionSavedRefreshFailed',
          ),
        )
        return true
      } catch (error) {
        setSaveError(messageForError(error, 'transactionSaveFailed'))
        return false
      } finally {
        submitting.current = false
        setSaving(false)
      }
    },
    [refresh, setDemoSnapshot, source],
  )

  const removeTransaction = useCallback(
    async (transaction: Transaction) => {
      if (submitting.current) return false
      submitting.current = true
      setSaving(true)
      setSaveError(null)
      setActionMessage(null)

      try {
        if (!navigator.onLine) {
          setSaveError(message('transactionOfflineError'))
          return false
        }

        if (source === 'demo') {
          deleteDemo(transaction.id)
          setDemoSnapshot()
          setActionMessage(message('demoTransactionChanged'))
          return true
        }

        await actionData(deleteTransactionAction(transaction.id, { updatedAt: transaction.updatedAt }))
        const refreshed = await refresh('error')
        setActionMessage(message(refreshed ? 'transactionDeleted' : 'transactionSavedRefreshFailed'))
        return true
      } catch (error) {
        setSaveError(messageForError(error, 'transactionDeleteFailed'))
        return false
      } finally {
        submitting.current = false
        setSaving(false)
      }
    },
    [refresh, setDemoSnapshot, source],
  )

  const setSelectedTransactionsClearing = useCallback(
    async (transactions: Transaction[], cleared: boolean) => {
      if (submitting.current || transactions.length === 0) return false
      submitting.current = true
      setSaving(true)
      setSaveError(null)
      setActionMessage(null)

      const input = {
        cleared,
        transactions: transactions.map(({ id, updatedAt }) => ({ id, updatedAt })),
      }

      try {
        if (!navigator.onLine) {
          setSaveError(message('transactionOfflineError'))
          return false
        }

        if (source === 'demo') {
          const result = setDemoTransactionsClearing(input)
          if (result.kind === 'version_conflict') {
            setSaveError(message('errorTransactionVersionConflict'))
            return false
          }
          setDemoSnapshot()
        } else {
          await actionData(setTransactionsClearingAction(input))
          const refreshed = await refresh('error')
          if (!refreshed) {
            setActionMessage(message('transactionSavedRefreshFailed'))
            return true
          }
        }

        setActionMessage(message(
          transactions.length === 1
            ? 'bulkTransactionsClearingUpdatedOne'
            : 'bulkTransactionsClearingUpdated',
          {
            count: transactions.length,
            status: message(cleared ? 'cleared' : 'uncleared'),
          },
        ))
        return true
      } catch (error) {
        setSaveError(messageForError(error, 'transactionBulkClearingFailed'))
        return false
      } finally {
        submitting.current = false
        setSaving(false)
      }
    },
    [refresh, setDemoSnapshot, source],
  )

  const setSelectedTransactionsImportReviewStatus = useCallback(
    async (transactions: Transaction[], nextStatus: ImportReviewStatus) => {
      if (
        submitting.current
        || transactions.length === 0
        || transactions.some(({ importReviewStatus }) => importReviewStatus == null)
      ) return false
      submitting.current = true
      setSaving(true)
      setSaveError(null)
      setActionMessage(null)

      try {
        if (source === 'demo') {
          setSaveError(message('importReviewUnavailable'))
          return false
        }
        if (!navigator.onLine) {
          setSaveError(message('transactionOfflineError'))
          return false
        }

        await actionData(setTransactionsImportReviewStatusAction({
          status: nextStatus,
          transactions: transactions.map(({ id, updatedAt }) => ({ id, updatedAt })),
        }))
        const refreshed = await refresh('error')
        if (!refreshed) {
          setActionMessage(message('transactionSavedRefreshFailed'))
          return true
        }

        const statusKey = nextStatus === 'unreviewed'
          ? 'importReviewUnreviewed'
          : nextStatus === 'needs_follow_up'
            ? 'importReviewNeedsFollowUp'
            : 'importReviewReviewed'
        setActionMessage(message(
          transactions.length === 1
            ? 'bulkTransactionsImportReviewUpdatedOne'
            : 'bulkTransactionsImportReviewUpdated',
          { count: transactions.length, status: message(statusKey) },
        ))
        return true
      } catch (error) {
        setSaveError(messageForError(error, 'transactionBulkImportReviewFailed'))
        return false
      } finally {
        submitting.current = false
        setSaving(false)
      }
    },
    [refresh, source],
  )

  const setAccountRegisterEntryClearing = useCallback(
    async (input: AccountRegisterClearingInput) => {
      if (submitting.current) return false
      submitting.current = true
      setSaving(true)
      setSaveError(null)
      setActionMessage(null)

      try {
        if (!navigator.onLine || source !== 'live') {
          setSaveError(message('accountRegisterEntryClearingFailed'))
          return false
        }

        await actionData(setAccountRegisterEntryClearingAction(input))
        const refreshed = await refresh('error')
        setActionMessage(message(
          refreshed
            ? 'accountRegisterEntryClearingUpdated'
            : 'transactionSavedRefreshFailed',
          refreshed ? { status: message(input.cleared ? 'cleared' : 'uncleared') } : undefined,
        ))
        return true
      } catch (error) {
        setSaveError(messageForError(error, 'accountRegisterEntryClearingFailed'))
        return false
      } finally {
        submitting.current = false
        setSaving(false)
      }
    },
    [refresh, source],
  )

  const setSelectedTransactionsCategory = useCallback(
    async (transactions: Transaction[], targetCategoryId: number) => {
      if (submitting.current || transactions.length === 0) return false
      submitting.current = true
      setSaving(true)
      setSaveError(null)
      setActionMessage(null)

      const input = {
        categoryId: targetCategoryId,
        transactions: transactions.map(({ id, updatedAt }) => ({ id, updatedAt })),
      }

      try {
        if (!navigator.onLine) {
          setSaveError(message('transactionOfflineError'))
          return false
        }

        if (source === 'demo') {
          const result = setDemoTransactionsCategory(input)
          if (result.kind === 'version_conflict') {
            setSaveError(message('errorTransactionVersionConflict'))
            return false
          }
          if (result.kind === 'reference_invalid') {
            setSaveError(message(
              result.code === 'CATEGORY_INVALID' ? 'errorCategoryInvalid' : 'errorCategoryMismatch',
            ))
            return false
          }
          setDemoSnapshot()
        } else {
          await actionData(setTransactionsCategoryAction(input))
          const refreshed = await refresh('error')
          if (!refreshed) {
            setActionMessage(message('transactionSavedRefreshFailed'))
            return true
          }
        }

        setActionMessage(message(
          transactions.length === 1
            ? 'bulkTransactionsCategoryUpdatedOne'
            : 'bulkTransactionsCategoryUpdated',
          { count: transactions.length },
        ))
        return true
      } catch (error) {
        setSaveError(messageForError(error, 'transactionBulkCategoryFailed'))
        return false
      } finally {
        submitting.current = false
        setSaving(false)
      }
    },
    [refresh, setDemoSnapshot, source],
  )

  const saveAccountTransfer = useCallback(
    async (input: AccountTransferInput, original?: AccountTransfer) => {
      if (submitting.current) return false
      submitting.current = true
      setSaving(true)
      setSaveError(null)
      setActionMessage(null)

      try {
        if (!navigator.onLine || source !== 'live') {
          setSaveError(message(source === 'live' ? 'transferOfflineError' : 'transferUnavailable'))
          return false
        }

        if (original) {
          const { id, ...fields } = input
          await actionData(updateAccountTransferAction(id, {
            ...fields,
            updatedAt: original.updatedAt,
          }))
        } else {
          await actionData(createAccountTransferAction(input))
        }
        const refreshed = await refresh('error')
        setActionMessage(message(
          refreshed
            ? original ? 'transferUpdated' : 'transferSaved'
            : 'transactionSavedRefreshFailed',
        ))
        return true
      } catch (error) {
        setSaveError(messageForError(error, 'transferSaveFailed'))
        return false
      } finally {
        submitting.current = false
        setSaving(false)
      }
    },
    [refresh, source],
  )

  const removeAccountTransfer = useCallback(
    async (transfer: AccountTransfer) => {
      if (submitting.current) return false
      submitting.current = true
      setSaving(true)
      setSaveError(null)
      setActionMessage(null)

      try {
        if (!navigator.onLine || source !== 'live') {
          setSaveError(message(source === 'live' ? 'transferOfflineError' : 'transferUnavailable'))
          return false
        }
        await actionData(deleteAccountTransferAction(transfer.id, { updatedAt: transfer.updatedAt }))
        const refreshed = await refresh('error')
        setActionMessage(message(refreshed ? 'transferDeleted' : 'transactionSavedRefreshFailed'))
        return true
      } catch (error) {
        setSaveError(messageForError(error, 'transferDeleteFailed'))
        return false
      } finally {
        submitting.current = false
        setSaving(false)
      }
    },
    [refresh, source],
  )

  const visibleSnapshot = useMemo(
    () =>
      source === 'demo'
        ? {
            ...snapshot,
            transactions: getDemoTransactions(
              month, type, search, t, accountId, categoryId, tag, status, sort, duplicatesOnly, scope,
              dateFrom, dateTo, payee, snapshot.ledgerSettings.currency, amountMinor,
              importReviewStatus,
            ),
            transactionFilterSummary: summarizeDemoTransactions(
              month,
              type,
              search,
              t,
              accountId,
              categoryId,
              tag,
              status,
              duplicatesOnly,
              scope,
              dateFrom,
              dateTo,
              payee,
              snapshot.ledgerSettings.currency,
              amountMinor,
              importReviewStatus,
            ),
            summary: demoSummary(month, t),
          }
        : snapshot,
    [accountId, amountMinor, categoryId, dateFrom, dateTo, duplicatesOnly, importReviewStatus, month, payee, scope, search, snapshot, sort, source, status, t, tag, type],
  )

  const clearActionMessage = useCallback(() => setActionMessage(null), [])

  return {
    ...visibleSnapshot,
    source,
    online,
    saving,
    snapshotVersion,
    transactionPageHasMore: source === 'live' && transactionPage.nextCursor !== null,
    transactionPageLoading: transactionPage.loading,
    transactionPageError: renderMessage(t, transactionPage.error),
    transactionPageLoadedMore: transactionPage.loadedMore,
    transactionPageRefreshRequired: transactionPage.refreshRequired,
    saveError: renderMessage(t, saveError),
    actionMessage: renderMessage(t, actionMessage),
    refresh,
    loadMoreTransactions,
    retryTransactionPageRefresh: recoverTransactionPage,
    saveTransaction,
    removeTransaction,
    setSelectedTransactionsCategory,
    setSelectedTransactionsClearing,
    setSelectedTransactionsImportReviewStatus,
    setAccountRegisterEntryClearing,
    saveAccountTransfer,
    removeAccountTransfer,
    clearActionMessage,
  }
}
