import { LoaderCircle, ShieldCheck, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react'
import { messageForError, renderMessage, useI18n } from '../i18n'
import {
  MAX_AI_STATEMENT_BYTES,
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
}

export function BankImportPanel({
  settings,
  accounts,
  categories,
  online,
  panelRef,
  onClose,
  onConfigure,
}: BankImportPanelProps) {
  const { locale, localizeEntityName, t } = useI18n()
  const activeAccounts = accounts.filter((account) => account.isActive)
  const [accountId, setAccountId] = useState(activeAccounts[0]?.id ?? 0)
  const [dateOrder, setDateOrder] = useState<AiDateOrder>('DMY')
  const [statementText, setStatementText] = useState('')
  const [drafts, setDrafts] = useState<EditableBankImportDraft[]>([])
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const requestIdRef = useRef(0)
  const requestControllerRef = useRef<AbortController | null>(null)
  const configured = aiProviderSettingsSchema.safeParse(settings).success
  const statementBytes = new TextEncoder().encode(statementText.trim()).byteLength

  useEffect(() => () => {
    requestIdRef.current += 1
    requestControllerRef.current?.abort()
  }, [])

  const invalidateDrafts = () => {
    requestIdRef.current += 1
    requestControllerRef.current?.abort()
    requestControllerRef.current = null
    setAnalyzing(false)
    setDrafts([])
    setStatus('')
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
          <textarea
            value={statementText}
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
              return (
                <article className="ai-draft-row" key={draft.id}>
                  <div className="ai-draft-source">
                    <span>{t('aiSourceLine', { line: draft.sourceLine })}</span>
                    <q>{draft.sourceText}</q>
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
                        onChange={(event) => updateDraftType(draft, event.target.value as TransactionType)}
                      >
                        <option value="expense">{t('expense')}</option>
                        <option value="income">{t('income')}</option>
                      </select>
                    </label>
                    <label>
                      <span>{t('amount')}</span>
                      <input
                        value={draft.amountText}
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
                        onChange={(event) => updateDraft(draft.id, { payee: event.target.value })}
                        maxLength={80}
                      />
                    </label>
                    <label className="ai-draft-category">
                      <span>{t('category')}</span>
                      <select
                        value={draft.categoryId ?? ''}
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
                      onClick={() => setDrafts((current) => current.filter((item) => item.id !== draft.id))}
                      aria-label={t('aiRemoveDraft')}
                    >
                      <Trash2 aria-hidden="true" />
                    </button>
                  </div>
                </article>
              )
            })}
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
