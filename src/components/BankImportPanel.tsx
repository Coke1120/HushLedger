import { LoaderCircle, ShieldCheck, Trash2, X } from 'lucide-react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { messageForError, renderMessage, useI18n, type MessageKey } from '../i18n'
import {
  MAX_AI_STATEMENT_BYTES,
  autoSelectedBankImportKeys,
  canUseStoredAiProvider,
  calculateBankStatementVerification,
  aiImportRequestSchema,
  aiImportRowSchema,
  aiProviderSettingsSchema,
  bankStatementParseResultSchema,
  type AiDateOrder,
  type AiProviderSettings,
  type AiProviderSettingsRow,
  type BankImportDraft,
  type BankStatementVerification,
  type BankStatementVerificationEvidence,
} from '../lib/ai'
import { ApiError, api } from '../lib/api'
import { isValidCalendarDate } from '../lib/date'
import { parseAmount } from '../lib/money'
import type { Account, Category, TransactionType } from '../lib/schema'
import {
  statementTransferImportInputSchema,
  statementTransferImportResponseSchema,
} from '../lib/statementTransferImport'
import {
  transactionImportCommitResultSchema,
  transactionImportPreviewResultSchema,
  type TransactionImportPreviewResult,
  type TransactionImportRow,
  type TransactionImportRowStatus,
} from '../lib/transactionImport'

type EditableBankImportDraft = Omit<BankImportDraft, 'amountMinor'> & {
  amountMinor: number | null
}

type CompletedImportActions = {
  accountId: number
  closingBalanceMinor: number | null
  dateFrom: string | null
  latestEntryDate: string | null
  hasUnreviewed: boolean
  hasFollowUp: boolean
}

type BankImportPanelProps = {
  settings: AiProviderSettings
  persistedSettings: AiProviderSettingsRow | null
  settingsConflict: boolean
  persistedSettingsAvailable: boolean
  accounts: Account[]
  categories: Category[]
  available: boolean
  panelRef: RefObject<HTMLElement | null>
  onClose: () => void
  onConfigure: () => void
  onImported: () => Promise<unknown>
  onReviewImports: (status: 'unreviewed' | 'needs_follow_up') => void
  onReconcile: (statement: {
    accountId: number
    closingBalanceMinor: number
    dateFrom: string
    dateTo: string
  }) => void
  onMutationStateChange: (mutating: boolean) => void
}

export function BankImportPanel({
  settings,
  persistedSettings,
  settingsConflict,
  persistedSettingsAvailable,
  accounts,
  categories,
  available,
  panelRef,
  onClose,
  onConfigure,
  onImported,
  onReviewImports,
  onReconcile,
  onMutationStateChange,
}: BankImportPanelProps) {
  const { formatDate, formatMoney, locale, localizeEntityName, privacyMode, t } = useI18n()
  const activeAccounts = accounts.filter((account) => account.isActive)
  const [accountId, setAccountId] = useState(
    activeAccounts.length === 1 ? activeAccounts[0]?.id ?? 0 : 0,
  )
  const selectedAccount = activeAccounts.find((account) => account.id === accountId)
  const [dateOrder, setDateOrder] = useState<AiDateOrder>(() => defaultDateOrder(locale))
  const [statementText, setStatementText] = useState('')
  const [drafts, setDrafts] = useState<EditableBankImportDraft[]>([])
  const [verificationEvidence, setVerificationEvidence] =
    useState<BankStatementVerificationEvidence | null>(null)
  const [preview, setPreview] = useState<TransactionImportPreviewResult | null>(null)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set())
  const [analyzing, setAnalyzing] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [transferringDraftId, setTransferringDraftId] = useState<string | null>(null)
  const [counterpartyAccountIds, setCounterpartyAccountIds] = useState<Record<string, number>>({})
  const [createdTransferKeys, setCreatedTransferKeys] = useState<Set<string>>(() => new Set())
  const [transferErrors, setTransferErrors] = useState<Record<string, string>>({})
  const [completedImport, setCompletedImport] = useState<CompletedImportActions | null>(null)
  const [statementCloseDate, setStatementCloseDate] = useState('')
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const requestIdRef = useRef(0)
  const requestControllerRef = useRef<AbortController | null>(null)
  const transientProvider = aiProviderSettingsSchema.safeParse(settings)
  const canUseStoredProvider = canUseStoredAiProvider(
    settings,
    persistedSettings,
    persistedSettingsAvailable,
    settingsConflict,
  )
  const configured = transientProvider.success || canUseStoredProvider
  const mutating = importing || transferringDraftId !== null
  const transferBusy = analyzing || previewing || mutating
  const statementBytes = new TextEncoder().encode(statementText.trim()).byteLength
  const verification = useMemo(
    () => recalculateVerification(verificationEvidence, drafts),
    [drafts, verificationEvidence],
  )
  const effectiveDrafts = useMemo(
    () => effectiveBankImportDrafts(drafts, verification),
    [drafts, verification],
  )
  const previewStatusByKey = useMemo(
    () => new Map(preview?.rows.map((row) => [row.importKey, row.status]) ?? []),
    [preview],
  )
  const validStatementCloseDate = completedImport?.dateFrom !== null
    && completedImport?.dateFrom !== undefined
    && completedImport.latestEntryDate !== null
    && isValidCalendarDate(statementCloseDate)
    && statementCloseDate >= completedImport.latestEntryDate

  useEffect(() => () => {
    requestIdRef.current += 1
    requestControllerRef.current?.abort()
    onMutationStateChange(false)
  }, [onMutationStateChange])

  useEffect(() => {
    if (available) return
    const timeout = window.setTimeout(() => {
      requestIdRef.current += 1
      requestControllerRef.current?.abort()
      requestControllerRef.current = null
      setDrafts([])
      setVerificationEvidence(null)
      setPreview(null)
      setSelectedKeys(new Set())
      setCounterpartyAccountIds({})
      setCreatedTransferKeys(new Set())
      setTransferErrors({})
      setCompletedImport(null)
      setStatementCloseDate('')
      setAnalyzing(false)
      setPreviewing(false)
      setImporting(false)
      setTransferringDraftId(null)
      onMutationStateChange(false)
      setStatus('')
      setError('')
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [available, onMutationStateChange])

  const cancelPendingRequest = () => {
    requestIdRef.current += 1
    requestControllerRef.current?.abort()
    requestControllerRef.current = null
    setAnalyzing(false)
    setPreviewing(false)
    setImporting(false)
    setTransferringDraftId(null)
    onMutationStateChange(false)
  }

  const invalidateDrafts = () => {
    cancelPendingRequest()
    setDrafts([])
    setVerificationEvidence(null)
    setPreview(null)
    setSelectedKeys(new Set())
    setCounterpartyAccountIds({})
    setCreatedTransferKeys(new Set())
    setTransferErrors({})
    setCompletedImport(null)
    setStatementCloseDate('')
    setStatus('')
    setError('')
  }

  const invalidatePreview = () => {
    cancelPendingRequest()
    setPreview(null)
    setSelectedKeys(new Set())
    setTransferErrors({})
    setStatus(t('aiDraftChanged'))
    setError('')
  }

  const analyze = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setStatus('')

    const parsedTransientProvider = aiProviderSettingsSchema.safeParse(settings)
    if (!parsedTransientProvider.success && !canUseStoredProvider) {
      setError(t('aiConfigureFirst'))
      return
    }
    const provider = parsedTransientProvider.success
      ? { source: 'transient' as const, ...parsedTransientProvider.data }
      : { source: 'stored' as const, expectedUpdatedAt: persistedSettings!.updatedAt }
    if (!available) {
      setError(t('aiOffline'))
      return
    }
    if (!selectedAccount) {
      setError(t('errorAccountInvalid'))
      return
    }
    if (statementBytes > MAX_AI_STATEMENT_BYTES) {
      setError(t('errorAiStatementTooLarge'))
      return
    }

    setAnalyzing(true)
    setDrafts([])
    setVerificationEvidence(null)
    setPreview(null)
    setSelectedKeys(new Set())
    setCounterpartyAccountIds({})
    setCreatedTransferKeys(new Set())
    setTransferErrors({})
    setCompletedImport(null)
    setStatementCloseDate('')
    const requestId = ++requestIdRef.current
    requestControllerRef.current?.abort()
    const controller = new AbortController()
    requestControllerRef.current = controller
    try {
      const result = await api<unknown>('/api/imports/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          accountId,
          currency: selectedAccount.currency,
          dateOrder,
          statementText,
        }),
        signal: controller.signal,
      })
      if (requestId !== requestIdRef.current) return
      const parsedResult = bankStatementParseResultSchema.safeParse(result)
      if (!parsedResult.success) throw new Error('Invalid draft response')
      const evidence: BankStatementVerificationEvidence = {
        openingBalance: parsedResult.data.verification.openingBalance,
        closingBalance: parsedResult.data.verification.closingBalance,
        debitTotal: parsedResult.data.verification.debitTotal,
        creditTotal: parsedResult.data.verification.creditTotal,
      }
      const recalculatedVerification = recalculateVerification(evidence, parsedResult.data.drafts)
      const parsedDrafts = effectiveBankImportDrafts(
        parsedResult.data.drafts,
        recalculatedVerification,
      )
      setDrafts(parsedResult.data.drafts)
      setVerificationEvidence(evidence)
      setStatus(
        parsedResult.data.drafts.length > 0
          ? t('aiDraftCount', { count: parsedResult.data.drafts.length })
          : t('aiNoDrafts'),
      )
      if (parsedResult.data.drafts.length > 0) {
        await previewDrafts(
          parsedDrafts,
          requestId,
          controller.signal,
          canAutomaticallySelectBankImport(recalculatedVerification),
        )
      }
    } catch (caught) {
      if (controller.signal.aborted || requestId !== requestIdRef.current) return
      setError(renderMessage(t, messageForError(caught, 'errorAiParseFailed')))
    } finally {
      if (requestId === requestIdRef.current) {
        requestControllerRef.current = null
        setAnalyzing(false)
      }
    }
  }

  const updateDraft = (id: string, patch: Partial<EditableBankImportDraft>) => {
    invalidatePreview()
    setDrafts((current) => current.map(
      (draft) => draft.id === id ? { ...draft, ...patch } : draft,
    ))
  }

  const updateDraftType = (draft: EditableBankImportDraft, type: TransactionType) => {
    const categoryMatches = categories.some(
      (category) => category.id === draft.categoryId && category.type === type,
    )
    updateDraft(draft.id, { type, categoryId: categoryMatches ? draft.categoryId : null })
  }

  const updateDraftAmount = (draft: EditableBankImportDraft, amountText: string) => {
    let amountMinor: number | null = null
    try {
      amountMinor = parseAmount(amountText, locale)
    } catch {
      // The raw value stays editable, but invalid text is never treated as an amount.
    }
    updateDraft(draft.id, { amountText, amountMinor })
  }

  const removeDraft = (id: string) => {
    invalidatePreview()
    setDrafts((current) => current.filter((item) => item.id !== id))
  }

  const toggleDraft = (importKey: string, include: boolean) => {
    setSelectedKeys((current) => {
      const next = new Set(current)
      if (include) next.add(importKey)
      else next.delete(importKey)
      return next
    })
  }

  const previewDrafts = async (
    nextDrafts = effectiveDrafts,
    requestId = ++requestIdRef.current,
    existingSignal?: AbortSignal,
    allowAutomaticSelection = canAutomaticallySelectBankImport(verification),
  ) => {
    setPreview(null)
    setSelectedKeys(new Set())
    if (!available) {
      cancelPendingRequest()
      setError(t('aiOffline'))
      return false
    }
    const rows = importRows(nextDrafts)
    if (rows.length === 0) {
      setPreview(null)
      setSelectedKeys(new Set())
      setStatus(t('aiNoValidDrafts'))
      return false
    }

    setPreviewing(true)
    setError('')
    if (!existingSignal) {
      requestControllerRef.current?.abort()
      requestControllerRef.current = new AbortController()
    }
    const signal = existingSignal ?? requestControllerRef.current?.signal

    try {
      const request = aiImportRequestSchema.parse({ mode: 'preview', rows })
      const response = await api<unknown>('/api/imports/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal,
      })
      if (requestId !== requestIdRef.current) return false
      const parsed = transactionImportPreviewResultSchema.safeParse(response)
      if (!parsed.success) throw new Error('Invalid AI import preview')
      setPreview(parsed.data)
      setSelectedKeys(autoSelectedBankImportKeys(
        nextDrafts,
        parsed.data.rows,
        allowAutomaticSelection,
      ))
      setStatus(t('aiPreviewReady'))
      return true
    } catch (caught) {
      if (signal?.aborted || requestId !== requestIdRef.current) return false
      setPreview(null)
      setSelectedKeys(new Set())
      setError(renderMessage(t, messageForError(caught, 'errorAiPreviewFailed')))
      return false
    } finally {
      if (requestId === requestIdRef.current) {
        if (!existingSignal) requestControllerRef.current = null
        setPreviewing(false)
      }
    }
  }

  const commitDrafts = async () => {
    if (!available) {
      cancelPendingRequest()
      setError(t('aiOffline'))
      return
    }
    if (!preview || selectedKeys.size === 0 || mutating) return
    const rows = importRows(effectiveDrafts, previewStatusByKey).map((row) => ({
      ...row,
      include: selectedKeys.has(row.importKey),
    }))
    if (
      rows.length !== preview.rows.length
      || rows.some((row, index) => row.importKey !== preview.rows[index]?.importKey)
    ) {
      invalidatePreview()
      setError(t('errorAiPreviewFailed'))
      return
    }

    const committedDrafts = effectiveDrafts.filter((draft) => selectedKeys.has(draft.importKey))
    const completionContext = statementCompletionContext(
      verificationEvidence,
      committedDrafts,
      accountId,
    )
    onMutationStateChange(true)
    setImporting(true)
    setError('')
    const requestId = ++requestIdRef.current
    requestControllerRef.current?.abort()
    const controller = new AbortController()
    requestControllerRef.current = controller
    try {
      const request = aiImportRequestSchema.parse({ mode: 'commit', rows })
      const response = await api<unknown>('/api/imports/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal,
      })
      if (requestId !== requestIdRef.current) return
      const parsed = transactionImportCommitResultSchema.safeParse(response)
      if (!parsed.success) throw new Error('Invalid AI import result')

      const committedKeys = new Set(selectedKeys)
      const remaining = effectiveDrafts.filter((draft) => (
        !committedKeys.has(draft.importKey) && !createdTransferKeys.has(draft.importKey)
      ))
      if (parsed.data.imported + parsed.data.matched > 0) {
        setCompletedImport((current) => mergeCompletedImportActions(current, {
          ...completionContext,
          hasUnreviewed: committedDrafts.some((draft) => !draftNeedsFollowUp(
              draft,
              previewStatusByKey.get(draft.importKey),
            )),
          hasFollowUp: committedDrafts.some((draft) => draftNeedsFollowUp(
              draft,
              previewStatusByKey.get(draft.importKey),
            )),
        }))
      }
      setDrafts(remaining)
      setVerificationEvidence(null)
      setPreview(null)
      setSelectedKeys(new Set())
      setCreatedTransferKeys(new Set())
      if (remaining.length === 0) setStatementText('')
      setStatus(t('aiImportSuccess', {
        imported: parsed.data.imported,
        matched: parsed.data.matched,
        stale: parsed.data.staleSkipped,
      }))
      await onImported()
    } catch (caught) {
      if (controller.signal.aborted || requestId !== requestIdRef.current) return
      if (
        caught instanceof ApiError
        && (caught.code === 'AI_IMPORT_BLOCKED' || caught.code === 'AI_IMPORT_STALE')
      ) {
        setPreview(null)
        setSelectedKeys(new Set())
        setStatus(t('aiPreviewRequired'))
        return
      }
      setError(renderMessage(t, messageForError(caught, 'errorAiImportFailed')))
    } finally {
      onMutationStateChange(false)
      if (requestId === requestIdRef.current) {
        requestControllerRef.current = null
        setImporting(false)
      }
    }
  }

  const createStatementTransfer = async (
    draft: EditableBankImportDraft,
    compatibleAccounts: Account[],
  ) => {
    const counterpartyAccountId = counterpartyAccountIds[draft.id]
      ?? (compatibleAccounts.length === 1 ? compatibleAccounts[0]!.id : 0)
    if (
      !available
      || transferBusy
      || draft.amountMinor === null
      || !isValidCalendarDate(draft.occurredOn)
      || counterpartyAccountId === 0
      || transferDraftHasBlockingWarning(draft)
      || previewStatusByKey.get(draft.importKey) !== 'new'
    ) return

    setTransferErrors((current) => ({ ...current, [draft.id]: '' }))
    setTransferringDraftId(draft.id)
    onMutationStateChange(true)
    const requestId = ++requestIdRef.current
    requestControllerRef.current?.abort()
    const controller = new AbortController()
    requestControllerRef.current = controller
    const completionContext = statementCompletionContext(
      verificationEvidence,
      [draft],
      accountId,
    )
    try {
      const request = statementTransferImportInputSchema.parse({
        importKey: draft.importKey,
        statementAccountId: draft.accountId,
        counterpartyAccountId,
        amountMinor: draft.amountMinor,
        occurredOn: draft.occurredOn,
        direction: draft.type === 'expense' ? 'outflow' : 'inflow',
        note: draft.payee,
      })
      const response = await api<unknown>('/api/imports/statement-transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal,
      })
      if (requestId !== requestIdRef.current) return
      const parsed = statementTransferImportResponseSchema.safeParse(response)
      if (!parsed.success) throw new Error('Invalid statement transfer result')
      setCreatedTransferKeys((current) => new Set(current).add(draft.importKey))
      setCompletedImport((current) => mergeCompletedImportActions(current, completionContext))
      setStatus(t(
        parsed.data.kind === 'created'
          ? 'aiTransferCreated'
          : parsed.data.kind === 'matched'
            ? 'aiTransferMatched'
            : 'aiTransferAlreadyImported',
      ))
      await onImported()
    } catch (caught) {
      if (controller.signal.aborted || requestId !== requestIdRef.current) return
      setTransferErrors((current) => ({
        ...current,
        [draft.id]: caught instanceof ApiError
          && caught.code === 'STATEMENT_TRANSFER_POSSIBLE_DUPLICATE'
          ? t('aiTransferPossibleDuplicate')
          : renderMessage(t, messageForError(caught, 'errorAiTransferFailed')),
      }))
    } finally {
      onMutationStateChange(false)
      if (requestId === requestIdRef.current) {
        requestControllerRef.current = null
        setTransferringDraftId(null)
      }
    }
  }

  return (
    <section
      id="bank-import-panel"
      className="bank-import-panel"
      aria-labelledby="bank-import-title"
      aria-busy={analyzing || previewing || mutating}
      ref={panelRef}
      tabIndex={-1}
    >
      <div className="bank-import-heading">
        <div>
          <h3 id="bank-import-title">{t('aiImportTitle')}</h3>
          <p>{t('aiImportHelp')}</p>
        </div>
        <button className="icon-button" type="button" onClick={onClose} disabled={mutating} aria-label={t('aiCloseImport')}>
          <X aria-hidden="true" />
        </button>
      </div>

      {!configured ? (
        <div className="ai-configure-notice">
          <p>{t('aiConfigureFirst')}</p>
          <button className="button button-secondary" type="button" onClick={onConfigure}>
            {t('aiOpenSettings')}
          </button>
        </div>
      ) : null}

      <form className="bank-import-form" onSubmit={analyze} noValidate>
        <div className="bank-import-options">
          <label>
            <span>{t('aiTargetAccount')}</span>
            <select
              value={accountId}
              disabled={analyzing || previewing || mutating}
              onChange={(event) => {
                setAccountId(Number(event.target.value))
                invalidateDrafts()
              }}
              required
            >
              <option value={0} disabled>{t('aiChooseAccount')}</option>
              {activeAccounts.map((account) => (
                <option value={account.id} key={account.id}>
                  {localizeEntityName(account.name, account.localizationKey)}
                </option>
              ))}
            </select>
          </label>
          <details className="ai-import-advanced">
            <summary>{t('aiAdvancedOptions')}</summary>
            <label>
              <span>{t('aiDateOrder')}</span>
              <select
                value={dateOrder}
                disabled={analyzing || previewing || mutating}
                onChange={(event) => {
                  setDateOrder(event.target.value as AiDateOrder)
                  invalidateDrafts()
                }}
              >
                <option value="DMY">{t('aiDateOrderDmy')}</option>
                <option value="MDY">{t('aiDateOrderMdy')}</option>
                <option value="YMD">{t('aiDateOrderYmd')}</option>
              </select>
            </label>
          </details>
        </div>

        <label>
          <span>{t('aiStatement')}</span>
          <span className="ai-statement-input-wrap">
            <textarea
              value={statementText}
              disabled={analyzing || previewing || mutating}
              onChange={(event) => {
                setStatementText(event.target.value)
                invalidateDrafts()
              }}
              rows={8}
              maxLength={MAX_AI_STATEMENT_BYTES}
              autoComplete="off"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="none"
              aria-describedby="ai-statement-help ai-privacy-warning"
              aria-invalid={statementBytes > MAX_AI_STATEMENT_BYTES}
              required
            />
            {privacyMode && statementText ? (
              <span className="ai-statement-privacy-cover" aria-hidden="true">
                {t('sensitiveTextHidden')}
              </span>
            ) : null}
          </span>
          <small id="ai-statement-help">{t('aiStatementHelp')}</small>
          <small
            className={`ai-byte-count${statementBytes > MAX_AI_STATEMENT_BYTES ? ' is-error' : ''}`}
          >
            {t('aiStatementBytes', { count: statementBytes, limit: MAX_AI_STATEMENT_BYTES })}
          </small>
        </label>

        <div className="ai-provider-warning" id="ai-privacy-warning">
          <ShieldCheck aria-hidden="true" />
          <span>{t('aiPrivacyWarning')}</span>
        </div>

        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <p className="settings-save-status" aria-live="polite" aria-atomic="true">{status}</p>

        <button
          className="button button-primary"
          type="submit"
          disabled={
            analyzing ||
            previewing ||
            mutating ||
            !configured ||
            !available ||
            !selectedAccount ||
            !statementText.trim() ||
            statementBytes > MAX_AI_STATEMENT_BYTES
          }
        >
          {analyzing ? <LoaderCircle className="spin" aria-hidden="true" /> : null}
          {analyzing ? t('aiAnalyzing') : t('aiAnalyze')}
        </button>
      </form>

      {drafts.length > 0 ? (
        <div className="ai-draft-review">
          <div className="ai-draft-review-heading">
            <div>
              <h4>{t('aiDraftsTitle')}</h4>
              <p>{t('aiDraftsHelp')}</p>
            </div>
            <span>{t('aiDraftOnly')}</span>
          </div>

          {verification ? (
            <BankStatementVerificationSummary
              verification={verification}
              currency={effectiveDrafts[0]!.currency}
            />
          ) : null}

          <div className="ai-draft-list">
            {effectiveDrafts.map((draft) => {
              const matchingCategories = categories.filter(
                (category) => category.isActive && category.type === draft.type,
              )
              const validDate = isValidCalendarDate(draft.occurredOn)
              const validAmount = draft.amountMinor !== null
              const importStatus = previewStatusByKey.get(draft.importKey)
              const selectable = importStatus === 'new' ||
                importStatus === 'match_ready' ||
                importStatus === 'possible_duplicate'
              const possibleTransfer = draft.flags.includes('POSSIBLE_TRANSFER')
              const transferBlocked = possibleTransfer && (
                transferDraftHasBlockingWarning(draft)
                || importStatus !== 'new'
              )
              const transferCreated = createdTransferKeys.has(draft.importKey)
              const compatibleTransferAccounts = activeAccounts.filter((account) => (
                account.id !== draft.accountId && account.currency === draft.currency
              ))
              const counterpartyAccountId = counterpartyAccountIds[draft.id]
                ?? (compatibleTransferAccounts.length === 1
                  ? compatibleTransferAccounts[0]!.id
                  : 0)
              const needsReview = hasSafetyWarning(draft) ||
                !validDate ||
                !validAmount ||
                draft.categoryId === null ||
                (importStatus !== undefined && importStatus !== 'new' && importStatus !== 'match_ready')
              const selected = selectedKeys.has(draft.importKey)
              return (
                <article
                  className={`ai-draft-row${selected ? ' is-selected' : ''}`}
                  key={draft.id}
                  aria-labelledby={`${draft.id}-summary`}
                >
                  <div className="ai-draft-source">
                    <div className="ai-draft-selection">
                      <label>
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={!selectable || possibleTransfer || mutating}
                          onChange={(event) => toggleDraft(draft.importKey, event.target.checked)}
                          aria-label={t('aiSelectDraft', { line: draft.sourceLine })}
                          aria-describedby={possibleTransfer ? `${draft.id}-warnings` : undefined}
                        />
                        <span>{t('aiSourceLine', { line: draft.sourceLine })}</span>
                      </label>
                      <span className={`csv-import-status is-${transferCreated ? 'match' : importStatus ?? 'needs_review'}`}>
                        {transferCreated
                          ? t('aiTransferCreatedStatus')
                          : importStatus
                          ? t(importStatusMessageKey(importStatus))
                          : t('aiStatusNeedsReview')}
                      </span>
                    </div>
                    <q>{privacyMode ? t('sensitiveTextHidden') : draft.sourceText}</q>
                    <small>{t('aiConfidence', { percent: Math.round(draft.confidence * 100) })}</small>
                    <p className="ai-draft-compact" id={`${draft.id}-summary`}>
                      <span>{validDate ? formatDate(draft.occurredOn) : draft.occurredOn}</span>
                      <strong>{draft.payee || '—'}</strong>
                      <span>{t(draft.type)} · {draft.amountMinor === null
                        ? privacyMode ? t('sensitiveTextHidden') : draft.amountText
                        : formatMoney(draft.amountMinor, draft.currency)}
                      </span>
                    </p>
                    {draft.flags.length > 0 ? (
                      <ul
                        className="ai-draft-flags"
                        id={`${draft.id}-warnings`}
                        aria-label={t('aiWarnings')}
                      >
                        {draft.flags.map((flag) => (
                          <li key={flag}>{t(aiFlagMessageKey(flag))}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  {possibleTransfer ? (
                    <div className="ai-statement-transfer" aria-labelledby={`${draft.id}-transfer-title`}>
                      <div>
                        <strong id={`${draft.id}-transfer-title`}>{t('aiTransferTitle')}</strong>
                        <small id={`${draft.id}-transfer-direction`}>
                          {t(draft.type === 'expense'
                            ? 'aiTransferDirectionOutflow'
                            : 'aiTransferDirectionInflow')}
                        </small>
                        {transferBlocked ? (
                          <small className="ai-transfer-blocked" id={`${draft.id}-transfer-blocked`}>
                            {t('aiTransferBlockedWarning')}
                          </small>
                        ) : null}
                      </div>
                      {transferCreated ? (
                        <p role="status">{t('aiTransferCreatedStatus')}</p>
                      ) : (
                        <>
                          <label>
                            <span>{t('aiTransferCounterAccount')}</span>
                            <select
                              value={counterpartyAccountId}
                              disabled={transferBusy || compatibleTransferAccounts.length === 0}
                              onChange={(event) => setCounterpartyAccountIds((current) => ({
                                ...current,
                                [draft.id]: Number(event.target.value),
                              }))}
                              aria-describedby={`${draft.id}-transfer-direction${compatibleTransferAccounts.length === 0 ? ` ${draft.id}-transfer-unavailable` : ''}${transferBlocked ? ` ${draft.id}-transfer-blocked` : ''}`}
                            >
                              <option value={0} disabled>{t('aiTransferChooseCounterAccount')}</option>
                              {compatibleTransferAccounts.map((account) => (
                                <option value={account.id} key={account.id}>
                                  {localizeEntityName(account.name, account.localizationKey)}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button
                            className="button button-secondary"
                            type="button"
                            disabled={
                              transferBusy
                              || !available
                              || counterpartyAccountId === 0
                              || !validDate
                              || !validAmount
                              || transferBlocked
                            }
                            onClick={() => void createStatementTransfer(
                              draft,
                              compatibleTransferAccounts,
                            )}
                          >
                            {transferringDraftId === draft.id
                              ? <LoaderCircle className="spin" aria-hidden="true" />
                              : null}
                            {transferringDraftId === draft.id
                              ? t('aiTransferCreating')
                              : t('aiTransferCreate')}
                          </button>
                          {compatibleTransferAccounts.length === 0 ? (
                            <small id={`${draft.id}-transfer-unavailable`}>
                              {t('aiTransferNoCompatibleAccount')}
                            </small>
                          ) : null}
                        </>
                      )}
                      {transferErrors[draft.id] ? (
                        <p className="form-error" role="alert">{transferErrors[draft.id]}</p>
                      ) : null}
                    </div>
                  ) : null}
                  {!transferCreated ? <AiDraftDetails
                    initiallyOpen={needsReview && (!possibleTransfer || transferBlocked)}
                    label={`${t(needsReview ? 'aiReviewDraftDetails' : 'aiEditDraftDetails')} · ${t('aiSourceLine', { line: draft.sourceLine })}`}
                  >
                    <div className="ai-draft-fields">
                    <label>
                      <span>{t('date')}</span>
                      <input
                        type="date"
                        value={draft.occurredOn}
                        disabled={mutating}
                        onChange={(event) => updateDraft(draft.id, { occurredOn: event.target.value })}
                        aria-invalid={!validDate}
                        aria-describedby={!validDate ? `${draft.id}-date-error` : undefined}
                      />
                      {!validDate ? (
                        <small className="field-error" id={`${draft.id}-date-error`}>
                          {t('aiInvalidDraftDate')}
                        </small>
                      ) : null}
                    </label>
                    <label>
                      <span>{t('transactionType')}</span>
                      <select
                        value={draft.type}
                        disabled={mutating}
                        onChange={(event) => updateDraftType(draft, event.target.value as TransactionType)}
                      >
                        <option value="expense">{t('expense')}</option>
                        <option value="income">{t('income')}</option>
                      </select>
                    </label>
                    <label>
                      <span>{t('amount')}</span>
                      <input
                        type={privacyMode ? 'password' : 'text'}
                        value={draft.amountText}
                        disabled={mutating}
                        onChange={(event) => updateDraftAmount(draft, event.target.value)}
                        inputMode="decimal"
                        maxLength={32}
                        autoComplete="off"
                        aria-invalid={!validAmount}
                        aria-describedby={!validAmount ? `${draft.id}-amount-error` : undefined}
                      />
                      {!validAmount ? (
                        <small className="field-error" id={`${draft.id}-amount-error`}>
                          {t('aiInvalidDraftAmount')}
                        </small>
                      ) : null}
                    </label>
                    <label>
                      <span>{t('payee')}</span>
                      <input
                        value={draft.payee}
                        disabled={mutating}
                        onChange={(event) => updateDraft(draft.id, { payee: event.target.value })}
                        maxLength={80}
                      />
                    </label>
                    <label className="ai-draft-category">
                      <span>{t('category')}</span>
                      <select
                        value={draft.categoryId ?? ''}
                        disabled={mutating}
                        onChange={(event) => updateDraft(draft.id, {
                          categoryId: event.target.value ? Number(event.target.value) : null,
                        })}
                      >
                        <option value="">{t('aiChooseCategory')}</option>
                        {matchingCategories.map((category) => (
                          <option value={category.id} key={category.id}>
                            {localizeEntityName(category.name, category.localizationKey)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="icon-button ai-remove-draft"
                      type="button"
                      onClick={() => removeDraft(draft.id)}
                      disabled={mutating}
                      aria-label={t('aiRemoveDraft')}
                    >
                      <Trash2 aria-hidden="true" />
                    </button>
                    </div>
                  </AiDraftDetails> : null}
                </article>
              )
            })}
          </div>

          {preview ? (
            <div className="csv-import-summary ai-import-summary" aria-label={t('aiPreviewSummary')}>
              <span className="is-ready">{t('csvImportSummaryReady', { count: preview.ready })}</span>
              <span className="is-match">{t('csvImportSummaryMatchable', { count: preview.matchable })}</span>
              <span className="is-possible">{t('csvImportSummaryPossible', { count: preview.possibleDuplicates })}</span>
              <span>{t('csvImportSummarySkipped', { count: preview.skipped })}</span>
              <span className="is-blocked">{t('csvImportSummaryBlocked', { count: preview.blocked })}</span>
            </div>
          ) : null}

          <div className="ai-import-actions">
            <span>
              {preview
                ? t(selectedKeys.size === 1 ? 'aiSelectedDraftsOne' : 'aiSelectedDrafts', {
                    count: selectedKeys.size,
                  })
                : t('aiPreviewRequired')}
            </span>
            {preview ? (
              <button
                className="button button-primary"
                type="button"
                onClick={() => void commitDrafts()}
                disabled={!available || mutating || previewing || selectedKeys.size === 0}
              >
                {importing ? <LoaderCircle className="spin" aria-hidden="true" /> : null}
                {importing ? t('aiImporting') : t('aiImportSelected')}
              </button>
            ) : (
              <button
                className="button button-secondary"
                type="button"
                onClick={() => void previewDrafts()}
                disabled={!available || previewing || mutating}
              >
                {previewing ? <LoaderCircle className="spin" aria-hidden="true" /> : null}
                {previewing ? t('aiPreviewing') : t('aiPreviewDrafts')}
              </button>
            )}
          </div>
        </div>
      ) : null}
      {completedImport ? (
        <section className="ai-import-next" aria-labelledby="ai-import-next-title">
          <div>
            <h4 id="ai-import-next-title">{t('aiImportNextTitle')}</h4>
            <p>{t('aiImportNextHelp')}</p>
          </div>
          <div className="ai-import-next-actions">
            {completedImport.hasFollowUp ? (
              <button
                className="button button-primary"
                type="button"
                disabled={mutating}
                onClick={() => onReviewImports('needs_follow_up')}
              >
                {t('aiReviewFollowUps')}
              </button>
            ) : null}
            {completedImport.hasUnreviewed ? (
              <button
                className="button button-secondary"
                type="button"
                disabled={mutating}
                onClick={() => onReviewImports('unreviewed')}
              >
                {t('aiReviewUnreviewedImports')}
              </button>
            ) : null}
            {completedImport.closingBalanceMinor !== null
              && completedImport.dateFrom !== null
              && completedImport.latestEntryDate !== null ? (
                <div className="ai-import-reconcile-action">
                  <label>
                    <span>{t('statementClosesOn')}</span>
                    <input
                      type="date"
                      value={statementCloseDate}
                      min={completedImport.latestEntryDate}
                      disabled={mutating}
                      required
                      aria-invalid={statementCloseDate.length > 0 && !validStatementCloseDate}
                      aria-describedby={statementCloseDate.length > 0 && !validStatementCloseDate
                        ? 'ai-reconcile-close-date-help ai-reconcile-close-date-error'
                        : 'ai-reconcile-close-date-help'}
                      onChange={(event) => setStatementCloseDate(event.target.value)}
                    />
                    <small id="ai-reconcile-close-date-help">
                      {t('aiReconcileCloseDateHelp')}
                    </small>
                    {statementCloseDate.length > 0 && !validStatementCloseDate ? (
                      <small className="field-error" id="ai-reconcile-close-date-error">
                        {t('aiReconcileCloseDateInvalid')}
                      </small>
                    ) : null}
                  </label>
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={mutating || !validStatementCloseDate}
                    onClick={() => onReconcile({
                      accountId: completedImport.accountId,
                      closingBalanceMinor: completedImport.closingBalanceMinor as number,
                      dateFrom: completedImport.dateFrom as string,
                      dateTo: statementCloseDate,
                    })}
                  >
                    {t('aiReconcileImportedAccount')}
                  </button>
                </div>
              ) : null}
          </div>
        </section>
      ) : null}
    </section>
  )
}

function aiFlagMessageKey(flag: BankImportDraft['flags'][number]) {
  switch (flag) {
    case 'UNCERTAIN_DATE': return 'aiFlagUncertainDate'
    case 'UNCERTAIN_AMOUNT': return 'aiFlagUncertainAmount'
    case 'UNCERTAIN_DIRECTION': return 'aiFlagUncertainDirection'
    case 'UNCERTAIN_CATEGORY': return 'aiFlagUncertainCategory'
    case 'POSSIBLE_DUPLICATE': return 'aiFlagPossibleDuplicate'
    case 'POSSIBLE_TRANSFER': return 'aiFlagPossibleTransfer'
    case 'NEEDS_REVIEW': return 'aiFlagNeedsReview'
    case 'RUNNING_BALANCE_MISMATCH': return 'aiFlagRunningBalanceMismatch'
  }
}

export function BankStatementVerificationSummary({
  currency,
  verification,
}: {
  currency: BankImportDraft['currency']
  verification: BankStatementVerification
}) {
  const { formatMoney, t } = useI18n()
  const statusMessage: MessageKey = verification.status === 'matched'
    ? 'aiVerificationMatched'
    : verification.status === 'mismatch'
      ? 'aiVerificationMismatch'
      : 'aiVerificationUnavailable'
  const differences: Array<{ label: MessageKey; value: number | null }> = [
    { label: 'aiVerificationBalanceDifference', value: verification.balanceDifferenceMinor },
    { label: 'aiVerificationDebitDifference', value: verification.debitDifferenceMinor },
    { label: 'aiVerificationCreditDifference', value: verification.creditDifferenceMinor },
  ]

  return (
    <section
      className={`ai-verification is-${verification.status}`}
      aria-labelledby="ai-verification-title"
    >
      <div className="ai-verification-status" role="status" aria-live="polite" aria-atomic="true">
        <strong id="ai-verification-title">{t('aiVerificationTitle')}</strong>
        <span>{t(statusMessage)}</span>
      </div>
      <dl className="ai-verification-totals">
        <div>
          <dt>{t('aiVerificationParsedIncome')}</dt>
          <dd>{formatMoney(verification.parsedIncomeMinor, currency)}</dd>
        </div>
        <div>
          <dt>{t('aiVerificationParsedExpense')}</dt>
          <dd>{formatMoney(verification.parsedExpenseMinor, currency)}</dd>
        </div>
        <div>
          <dt>{t('aiVerificationParsedNet')}</dt>
          <dd>{formatMoney(verification.parsedNetMinor, currency)}</dd>
        </div>
      </dl>
      <p className={`ai-verification-running is-${verification.runningBalanceStatus}`}>
        {t(
          verification.runningBalanceStatus === 'matched'
            ? 'aiRunningBalanceMatched'
            : verification.runningBalanceStatus === 'mismatch'
              ? 'aiRunningBalanceMismatch'
              : 'aiRunningBalanceUnavailable',
          {
            count: verification.runningBalanceStatus === 'mismatch'
              ? verification.runningBalanceMismatchSourceLines.length
              : verification.runningBalanceCheckedRows,
          },
        )}
      </p>
      {verification.status === 'mismatch' ? (
        <ul className="ai-verification-differences">
          {differences
            .filter((difference): difference is { label: MessageKey; value: number } =>
              difference.value !== null && difference.value !== 0)
            .map((difference) => (
              <li key={difference.label}>
                <span>{t(difference.label)}</span>
                <strong>{formatMoney(difference.value, currency)}</strong>
              </li>
            ))}
        </ul>
      ) : null}
    </section>
  )
}

function importRows(
  drafts: readonly EditableBankImportDraft[],
  previewStatusByKey?: ReadonlyMap<string, TransactionImportRowStatus>,
): TransactionImportRow[] {
  return drafts.flatMap((draft) => {
    if (
      !isValidCalendarDate(draft.occurredOn) ||
      draft.amountMinor === null ||
      draft.categoryId === null
    ) {
      return []
    }

    const parsed = aiImportRowSchema.safeParse({
      id: draft.id,
      importKey: draft.importKey,
      sourceRow: draft.sourceLine,
      include: false,
      type: draft.type,
      amountMinor: draft.amountMinor,
      currency: draft.currency,
      accountId: draft.accountId,
      categoryId: draft.categoryId,
      occurredOn: draft.occurredOn,
      cleared: true,
      payee: draft.payee,
      note: '',
      initialReviewStatus: draftNeedsFollowUp(
        draft,
        previewStatusByKey?.get(draft.importKey),
      ) ? 'needs_follow_up' : undefined,
    })
    return parsed.success ? [parsed.data] : []
  })
}

function importStatusMessageKey(status: TransactionImportRowStatus): MessageKey {
  switch (status) {
    case 'new': return 'csvStatusNew'
    case 'match_ready': return 'csvStatusMatchReady'
    case 'possible_duplicate': return 'csvStatusPossibleDuplicate'
    case 'already_imported': return 'csvStatusAlreadyImported'
    case 'existing_transaction': return 'csvStatusExistingTransaction'
    case 'id_conflict': return 'csvStatusIdConflict'
    case 'account_invalid': return 'csvStatusAccountInvalid'
    case 'category_invalid': return 'csvStatusCategoryInvalid'
    case 'category_mismatch': return 'csvStatusCategoryMismatch'
  }
}

function defaultDateOrder(locale: string): AiDateOrder {
  if (locale.toLowerCase().startsWith('ja')) return 'YMD'
  if (locale.toLowerCase().startsWith('en-us')) return 'MDY'
  return 'DMY'
}

function hasSafetyWarning(draft: Pick<BankImportDraft, 'flags'>) {
  return draft.flags.some((flag) => flag !== 'UNCERTAIN_CATEGORY')
}

function draftNeedsFollowUp(
  draft: Pick<BankImportDraft, 'flags'>,
  previewStatus?: TransactionImportRowStatus,
) {
  return draft.flags.length > 0 || previewStatus === 'possible_duplicate'
}

function transferDraftHasBlockingWarning(draft: Pick<BankImportDraft, 'flags'>) {
  return draft.flags.some((flag) => (
    flag !== 'POSSIBLE_TRANSFER' && flag !== 'UNCERTAIN_CATEGORY'
  ))
}

function recalculateVerification(
  evidence: BankStatementVerificationEvidence | null,
  drafts: readonly EditableBankImportDraft[],
) {
  if (!evidence || drafts.some((draft) => draft.amountMinor === null)) return null
  try {
    return calculateBankStatementVerification(
      evidence,
      drafts.map((draft) => ({
        type: draft.type,
        amountMinor: draft.amountMinor as number,
        sourceLine: draft.sourceLine,
        occurredOn: draft.occurredOn,
        runningBalance: draft.runningBalance,
      })),
    )
  } catch {
    return null
  }
}

function effectiveBankImportDrafts(
  drafts: readonly EditableBankImportDraft[],
  verification: BankStatementVerification | null,
) {
  if (!verification) return drafts
  const mismatchSourceLines = new Set(
    verification.runningBalanceMismatchSourceLines,
  )
  return drafts.map((draft) => {
    const flags: BankImportDraft['flags'] = draft.flags.filter(
      (flag) => flag !== 'RUNNING_BALANCE_MISMATCH',
    )
    if (mismatchSourceLines.has(draft.sourceLine)) flags.push('RUNNING_BALANCE_MISMATCH')
    return flags.length === draft.flags.length
      && flags.every((flag, index) => flag === draft.flags[index])
      ? draft
      : { ...draft, flags }
  })
}

function statementCompletionContext(
  evidence: BankStatementVerificationEvidence | null,
  drafts: readonly EditableBankImportDraft[],
  accountId: number,
): CompletedImportActions {
  const dates = drafts
    .map((draft) => draft.occurredOn)
    .filter(isValidCalendarDate)
    .sort()
  return {
    accountId,
    closingBalanceMinor: evidence?.closingBalance?.amountMinor ?? null,
    dateFrom: dates[0] ?? null,
    latestEntryDate: dates.at(-1) ?? null,
    hasUnreviewed: false,
    hasFollowUp: false,
  }
}

function mergeCompletedImportActions(
  current: CompletedImportActions | null,
  next: CompletedImportActions,
): CompletedImportActions {
  if (!current) return next
  const starts = [current.dateFrom, next.dateFrom]
    .filter((date): date is string => date !== null)
    .sort()
  const ends = [current.latestEntryDate, next.latestEntryDate]
    .filter((date): date is string => date !== null)
    .sort()
  return {
    ...next,
    closingBalanceMinor: next.closingBalanceMinor ?? current.closingBalanceMinor,
    dateFrom: starts[0] ?? null,
    latestEntryDate: ends.at(-1) ?? null,
    hasUnreviewed: current.hasUnreviewed || next.hasUnreviewed,
    hasFollowUp: current.hasFollowUp || next.hasFollowUp,
  }
}

function canAutomaticallySelectBankImport(verification: BankStatementVerification | null) {
  return verification?.status === 'matched' || (
    verification?.status === 'unavailable'
    && verification.balanceDifferenceMinor === null
    && verification.debitDifferenceMinor === null
    && verification.creditDifferenceMinor === null
  )
}

function AiDraftDetails({
  children,
  initiallyOpen,
  label,
}: {
  children: ReactNode
  initiallyOpen: boolean
  label: string
}) {
  const [open, setOpen] = useState(initiallyOpen)
  const detailsRef = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    if (initiallyOpen && detailsRef.current) detailsRef.current.open = true
  }, [initiallyOpen])
  return (
    <details
      className="ai-draft-details"
      ref={detailsRef}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{label}</summary>
      {children}
    </details>
  )
}
