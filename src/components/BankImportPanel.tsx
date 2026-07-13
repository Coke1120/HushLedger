import { LoaderCircle, ShieldCheck, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from 'react'
import { messageForError, renderMessage, useI18n, type MessageKey } from '../i18n'
import {
  MAX_AI_STATEMENT_BYTES,
  aiImportRequestSchema,
  aiImportRowSchema,
  aiProviderSettingsSchema,
  bankImportDraftsSchema,
  type AiDateOrder,
  type AiProviderSettings,
  type BankImportDraft,
} from '../lib/ai'
import { api } from '../lib/api'
import { isValidCalendarDate } from '../lib/date'
import { parseAmount } from '../lib/money'
import type { Account, Category, TransactionType } from '../lib/schema'
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

type BankImportPanelProps = {
  settings: AiProviderSettings
  accounts: Account[]
  categories: Category[]
  online: boolean
  panelRef: RefObject<HTMLElement | null>
  onClose: () => void
  onConfigure: () => void
  onImported: () => Promise<unknown>
}

export function BankImportPanel({
  settings,
  accounts,
  categories,
  online,
  panelRef,
  onClose,
  onConfigure,
  onImported,
}: BankImportPanelProps) {
  const { locale, localizeEntityName, privacyMode, t } = useI18n()
  const activeAccounts = accounts.filter((account) => account.isActive)
  const [accountId, setAccountId] = useState(activeAccounts[0]?.id ?? 0)
  const [dateOrder, setDateOrder] = useState<AiDateOrder>('DMY')
  const [statementText, setStatementText] = useState('')
  const [drafts, setDrafts] = useState<EditableBankImportDraft[]>([])
  const [preview, setPreview] = useState<TransactionImportPreviewResult | null>(null)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set())
  const [analyzing, setAnalyzing] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const requestIdRef = useRef(0)
  const requestControllerRef = useRef<AbortController | null>(null)
  const configured = aiProviderSettingsSchema.safeParse(settings).success
  const statementBytes = new TextEncoder().encode(statementText.trim()).byteLength
  const previewStatusByKey = useMemo(
    () => new Map(preview?.rows.map((row) => [row.importKey, row.status]) ?? []),
    [preview],
  )

  useEffect(() => () => {
    requestIdRef.current += 1
    requestControllerRef.current?.abort()
  }, [])

  const cancelPendingRequest = () => {
    requestIdRef.current += 1
    requestControllerRef.current?.abort()
    requestControllerRef.current = null
    setAnalyzing(false)
    setPreviewing(false)
    setImporting(false)
  }

  const invalidateDrafts = () => {
    cancelPendingRequest()
    setDrafts([])
    setPreview(null)
    setSelectedKeys(new Set())
    setStatus('')
    setError('')
  }

  const invalidatePreview = () => {
    cancelPendingRequest()
    setPreview(null)
    setSelectedKeys(new Set())
    setStatus(t('aiDraftChanged'))
    setError('')
  }

  const analyze = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setStatus('')

    const provider = aiProviderSettingsSchema.safeParse(settings)
    if (!provider.success) {
      setError(t('aiConfigureFirst'))
      return
    }
    if (!online) {
      setError(t('aiOffline'))
      return
    }
    if (!activeAccounts.some((account) => account.id === accountId)) {
      setError(t('errorAccountInvalid'))
      return
    }
    if (statementBytes > MAX_AI_STATEMENT_BYTES) {
      setError(t('errorAiStatementTooLarge'))
      return
    }

    setAnalyzing(true)
    setDrafts([])
    const requestId = ++requestIdRef.current
    requestControllerRef.current?.abort()
    const controller = new AbortController()
    requestControllerRef.current = controller
    try {
      const result = await api<{ drafts: unknown }>('/api/imports/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: provider.data,
          accountId,
          currency: 'HKD',
          dateOrder,
          statementText,
        }),
        signal: controller.signal,
      })
      if (requestId !== requestIdRef.current) return
      const parsedDrafts = bankImportDraftsSchema.safeParse(result.drafts)
      if (!parsedDrafts.success) throw new Error('Invalid draft response')
      setDrafts(parsedDrafts.data)
      setStatus(
        parsedDrafts.data.length > 0
          ? t('aiDraftCount', { count: parsedDrafts.data.length })
          : t('aiNoDrafts'),
      )
      if (parsedDrafts.data.length > 0) {
        await previewDrafts(parsedDrafts.data, requestId, controller.signal)
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
    setDrafts((current) => current.map((draft) => draft.id === id ? { ...draft, ...patch } : draft))
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
    nextDrafts = drafts,
    requestId = ++requestIdRef.current,
    existingSignal?: AbortSignal,
  ) => {
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
      setSelectedKeys(new Set(
        parsed.data.rows
          .filter((row) => row.status === 'new' || row.status === 'match_ready')
          .map((row) => row.importKey),
      ))
      setStatus(t('aiPreviewReady'))
      return true
    } catch (caught) {
      if (signal?.aborted || requestId !== requestIdRef.current) return false
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
    if (!preview || selectedKeys.size === 0 || importing) return
    const rows = importRows(drafts).map((row) => ({
      ...row,
      include: selectedKeys.has(row.importKey),
    }))
    if (rows.length !== preview.rows.length) {
      invalidatePreview()
      setError(t('errorAiPreviewFailed'))
      return
    }

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
      const remaining = drafts.filter((draft) => !committedKeys.has(draft.importKey))
      setDrafts(remaining)
      setPreview(null)
      setSelectedKeys(new Set())
      if (remaining.length === 0) setStatementText('')
      setStatus(t('aiImportSuccess', {
        imported: parsed.data.imported,
        matched: parsed.data.matched,
        stale: parsed.data.staleSkipped,
      }))
      await onImported()
    } catch (caught) {
      if (controller.signal.aborted || requestId !== requestIdRef.current) return
      setError(renderMessage(t, messageForError(caught, 'errorAiImportFailed')))
    } finally {
      if (requestId === requestIdRef.current) {
        requestControllerRef.current = null
        setImporting(false)
      }
    }
  }

  return (
    <section
      id="bank-import-panel"
      className="bank-import-panel"
      aria-labelledby="bank-import-title"
      ref={panelRef}
      tabIndex={-1}
    >
      <div className="bank-import-heading">
        <div>
          <h3 id="bank-import-title">{t('aiImportTitle')}</h3>
          <p>{t('aiImportHelp')}</p>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label={t('aiCloseImport')}>
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
              disabled={analyzing || previewing || importing}
              onChange={(event) => {
                setAccountId(Number(event.target.value))
                invalidateDrafts()
              }}
              required
            >
              {activeAccounts.map((account) => (
                <option value={account.id} key={account.id}>
                  {localizeEntityName(account.name, account.localizationKey)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t('aiDateOrder')}</span>
            <select
              value={dateOrder}
              disabled={analyzing || previewing || importing}
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
        </div>

        <label>
          <span>{t('aiStatement')}</span>
          <span className="ai-statement-input-wrap">
            <textarea
              value={statementText}
              disabled={analyzing || previewing || importing}
              onChange={(event) => {
                setStatementText(event.target.value)
                invalidateDrafts()
              }}
              rows={8}
              maxLength={MAX_AI_STATEMENT_BYTES}
              autoComplete="off"
              spellCheck={false}
              aria-describedby="ai-statement-help"
              required
            />
            {privacyMode && statementText ? (
              <span className="ai-statement-privacy-cover" aria-hidden="true">
                {t('sensitiveTextHidden')}
              </span>
            ) : null}
          </span>
          <small id="ai-statement-help">{t('aiStatementHelp')}</small>
          <small className="ai-byte-count" aria-live="polite">
            {t('aiStatementBytes', { count: statementBytes, limit: MAX_AI_STATEMENT_BYTES })}
          </small>
        </label>

        <div className="ai-provider-warning">
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
            importing ||
            !configured ||
            !online ||
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

          <div className="ai-draft-list">
            {drafts.map((draft) => {
              const matchingCategories = categories.filter(
                (category) => category.isActive && category.type === draft.type,
              )
              const validDate = isValidCalendarDate(draft.occurredOn)
              const validAmount = draft.amountMinor !== null
              const importStatus = previewStatusByKey.get(draft.importKey)
              const selectable = importStatus === 'new' ||
                importStatus === 'match_ready' ||
                importStatus === 'possible_duplicate'
              const selected = selectedKeys.has(draft.importKey)
              return (
                <article
                  className={`ai-draft-row${selected ? ' is-selected' : ''}`}
                  key={draft.id}
                >
                  <div className="ai-draft-source">
                    <div className="ai-draft-selection">
                      <label>
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={!selectable || importing}
                          onChange={(event) => toggleDraft(draft.importKey, event.target.checked)}
                          aria-label={t('aiSelectDraft', { line: draft.sourceLine })}
                        />
                        <span>{t('aiSourceLine', { line: draft.sourceLine })}</span>
                      </label>
                      <span className={`csv-import-status is-${importStatus ?? 'needs_review'}`}>
                        {importStatus
                          ? t(importStatusMessageKey(importStatus))
                          : t('aiStatusNeedsReview')}
                      </span>
                    </div>
                    <q>{privacyMode ? t('sensitiveTextHidden') : draft.sourceText}</q>
                    <small>{t('aiConfidence', { percent: Math.round(draft.confidence * 100) })}</small>
                    {draft.flags.length > 0 ? (
                      <ul className="ai-draft-flags" aria-label={t('aiWarnings')}>
                        {draft.flags.map((flag) => (
                          <li key={flag}>{t(aiFlagMessageKey(flag))}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  <div className="ai-draft-fields">
                    <label>
                      <span>{t('date')}</span>
                      <input
                        type="date"
                        value={draft.occurredOn}
                        disabled={importing}
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
                        disabled={importing}
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
                        disabled={importing}
                        onChange={(event) => updateDraftAmount(draft, event.target.value)}
                        inputMode="decimal"
                        maxLength={32}
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
                        disabled={importing}
                        onChange={(event) => updateDraft(draft.id, { payee: event.target.value })}
                        maxLength={80}
                      />
                    </label>
                    <label className="ai-draft-category">
                      <span>{t('category')}</span>
                      <select
                        value={draft.categoryId ?? ''}
                        disabled={importing}
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
                      disabled={importing}
                      aria-label={t('aiRemoveDraft')}
                    >
                      <Trash2 aria-hidden="true" />
                    </button>
                  </div>
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
                disabled={importing || previewing || selectedKeys.size === 0}
              >
                {importing ? <LoaderCircle className="spin" aria-hidden="true" /> : null}
                {importing ? t('aiImporting') : t('aiImportSelected')}
              </button>
            ) : (
              <button
                className="button button-secondary"
                type="button"
                onClick={() => void previewDrafts()}
                disabled={previewing || importing}
              >
                {previewing ? <LoaderCircle className="spin" aria-hidden="true" /> : null}
                {previewing ? t('aiPreviewing') : t('aiPreviewDrafts')}
              </button>
            )}
          </div>
        </div>
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
  }
}

function importRows(drafts: readonly EditableBankImportDraft[]): TransactionImportRow[] {
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
