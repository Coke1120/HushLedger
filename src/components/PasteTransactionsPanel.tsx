import { ClipboardPaste, LoaderCircle, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useI18n, type MessageKey } from '../i18n'
import {
  aiProviderSettingsSchema, bankStatementParseResultSchema, canUseStoredAiProvider,
  MAX_AI_STATEMENT_BYTES, type AiDateOrder, type BankImportDraft,
} from '../lib/ai'
import { ApiError, api } from '../lib/api'
import { parseAmount } from '../lib/money'
import { sourceHasExplicitYear, pasteRowSchema, type PastePreview, type PasteReceipt, type PasteRow } from '../lib/pasteApproval'
import { BankImportPanel, type BankImportPanelProps } from './BankImportPanel'

type Draft = BankImportDraft & { selected: boolean; checked: boolean; duplicateConfirmed: boolean }
type Pending = { mode: 'approve'; operationId: string; expectedRevision: number; rows: PasteRow[] }

export function PasteTransactionsPanel({ panelRef, onClose, ...props }: BankImportPanelProps) {
  const { t, locale, localizeEntityName } = useI18n()
  const active = props.accounts.filter((account) => account.isActive)
  const [accountId, setAccountId] = useState(active.length === 1 ? active[0].id : 0)
  const account = active.find((item) => item.id === accountId)
  const [text, setText] = useState('')
  const [order, setOrder] = useState<AiDateOrder>(locale === 'en' ? 'MDY' : 'DMY')
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [preview, setPreview] = useState<PastePreview | null>(null)
  const [receipts, setReceipts] = useState<PasteReceipt[]>([])
  const [saved, setSaved] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [totalsWarning, setTotalsWarning] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)
  const running = useRef(false)
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])
  const locked = busy || pending !== null || !props.available
  const selected = drafts.filter((row) => row.selected && !saved.has(row.id))

  function change(id: string, patch: Partial<Draft>, fields = false) {
    setDrafts((rows) => rows.map((row) => row.id === id
      ? { ...row, ...patch, ...(fields ? { checked: false, selected: false, duplicateConfirmed: false } : {}) }
      : row))
    if (fields) setPreview(null)
  }
  function hasWarning(row: Draft) {
    return totalsWarning || row.flags.length > 0 || !sourceHasExplicitYear(row.sourceText, row.occurredOn)
  }
  function input(row: Draft): PasteRow {
    return pasteRowSchema.parse({
      id: row.id, importKey: row.importKey, type: row.type, occurredOn: row.occurredOn,
      accountId: row.accountId, currency: row.currency, categoryId: row.categoryId,
      amountMinor: parseAmount(row.amountText, 'en'), payee: row.payee, note: '', cleared: true,
      duplicateConfirmed: row.duplicateConfirmed,
    })
  }
  function valid(row: Draft) {
    if (saved.has(row.id) || row.flags.includes('POSSIBLE_TRANSFER') || preview?.rows.some((item) => item.id === row.id && item.imported)) return false
    if (!props.accounts.some((item) => item.id === row.accountId && item.isActive && item.currency === row.currency)
      || !props.categories.some((item) => item.id === row.categoryId && item.isActive && item.type === row.type)) return false
    if (hasWarning(row) && !row.checked) return false
    try { input(row); return true } catch { return false }
  }
  async function analyze() {
    if (running.current || !account || !props.available) return
    const transient = aiProviderSettingsSchema.safeParse(props.settings)
    const stored = canUseStoredAiProvider(props.settings, props.persistedSettings, props.persistedSettingsAvailable, props.settingsConflict)
    if (!transient.success && !stored) { props.onConfigure(); return }
    if (new TextEncoder().encode(text).byteLength > MAX_AI_STATEMENT_BYTES) { setError(true); return }
    running.current = true
    setBusy(true)
    setError(false)
    abort.current = new AbortController()
    try {
      const result = bankStatementParseResultSchema.parse(await api('/api/imports/parse', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: abort.current.signal,
        body: JSON.stringify({
          provider: transient.success ? { source: 'transient', ...transient.data }
            : { source: 'stored', expectedUpdatedAt: props.persistedSettings!.updatedAt },
          accountId, currency: account.currency, dateOrder: order, statementText: text,
        }),
      }))
      setDrafts(result.drafts.map((row) => ({ ...row, selected: false, checked: false, duplicateConfirmed: false })))
      setTotalsWarning(result.verification.status === 'mismatch')
      setPreview(null)
    } catch { setError(true) } finally { setBusy(false); running.current = false }
  }
  async function approve(rows: Draft[]) {
    if (running.current || !props.available) return
    if (!pending && (!rows.length || rows.some((row) => !valid(row)))) return
    running.current = true
    setBusy(true)
    setError(false)
    props.onMutationStateChange(true)
    try {
      let request = pending
      if (!request) {
        const inputs = rows.map(input)
        const result = await api<PastePreview>('/api/imports/approve', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'preview', rows: inputs }),
        })
        setPreview(result)
        if (result.rows.some((row) => !row.valid)) setError(true)
        if (result.rows.some((row, index) => !row.valid || row.imported
          || (row.duplicate && !inputs[index].duplicateConfirmed))) return
        request = { mode: 'approve', operationId: crypto.randomUUID(), expectedRevision: result.revision, rows: inputs }
        setPending(request)
      }
      const result = await api<PasteReceipt>('/api/imports/approve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
      })
      setReceipts((items) => [...items.filter((item) => item.operationId !== result.operationId), result])
      setSaved((ids) => new Set([...ids, ...request.rows.map((row) => row.id)]))
      setPending(null)
      await props.onImported()
    } catch (caught) {
      // Explicit rejection means no write occurred; unknown network outcomes retain the exact retry.
      if (caught instanceof ApiError && (caught.status === 409 || caught.status === 400)) setPending(null)
      setError(true)
    } finally {
      props.onMutationStateChange(false)
      setBusy(false)
      running.current = false
    }
  }
  async function undo(operationId: string) {
    if (running.current || locked) return
    running.current = true
    setBusy(true)
    setError(false)
    props.onMutationStateChange(true)
    try {
      const result = await api<PasteReceipt>('/api/imports/approve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'undo', operationId }),
      })
      setReceipts((items) => items.map((item) => item.operationId === operationId ? result : item))
      await props.onImported()
    } catch { setError(true) } finally {
      props.onMutationStateChange(false)
      setBusy(false)
      running.current = false
    }
  }
  if (advanced) return <BankImportPanel {...props} panelRef={panelRef} onClose={onClose} initialStatementText={text} initialAccountId={accountId} />
  return (
    <section className="paste-panel" id="bank-import-panel" ref={panelRef} tabIndex={-1} aria-busy={busy}>
      <div className="paste-heading">
        <div><h2><ClipboardPaste aria-hidden="true" /> {t('pasteTitle')}</h2><p>{t('pastePrivacy')}</p></div>
        <button type="button" className="icon-button" onClick={onClose} disabled={busy || pending !== null} aria-label={t('close')}><X /></button>
      </div>
      <details className="paste-source" open={drafts.length === 0}>
      <summary>{t('pasteOriginal')}{account ? ` · ${account.name} · ${account.currency}` : ''}</summary>
      <fieldset disabled={locked || drafts.length > 0} className="paste-inputs">
        <label>{t('pasteAccount')}<select aria-label={t('pasteAccount')} value={accountId} onChange={(event) => setAccountId(Number(event.target.value))}>
          <option value={0}>{t('pasteAccount')}</option>
          {active.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.currency}</option>)}
        </select></label>
        <label>{t('date')}<select aria-label={t('date')} value={order} onChange={(event) => setOrder(event.target.value as AiDateOrder)}>
          <option value="DMY">DD/MM/YYYY</option><option value="MDY">MM/DD/YYYY</option><option value="YMD">YYYY/MM/DD</option>
        </select></label>
        <label className="paste-text">{t('pasteText')}<textarea value={text} onChange={(event) => setText(event.target.value)} rows={5} /></label>
        <button type="button" className="primary-button" disabled={!account || !text.trim()} onClick={() => void analyze()}>{busy ? <LoaderCircle className="spin" /> : null}{t('pasteAnalyze')}</button>
      </fieldset>
      </details>
      {drafts.length > 0 ? <button type="button" className="text-button" disabled={locked} onClick={() => { setDrafts([]); setPreview(null) }}>{t('pasteReset')}</button> : null}
      {error ? <p className="form-error" role="alert">{t('pasteError')}</p> : null}
      {pending ? <button type="button" disabled={busy} onClick={() => void approve([])}>{t('retry')}</button> : null}
      {totalsWarning ? <p role="status">{t('pasteTotals')}</p> : null}
      <div className="paste-rows">
        {drafts.map((row) => {
          const state = preview?.rows.find((item) => item.id === row.id)
          const isSaved = saved.has(row.id)
          return <article className={`paste-row${isSaved ? ' is-saved' : ''}`} key={row.id}>
            <fieldset disabled={locked || isSaved || state?.imported}>
              <label className="paste-select"><input type="checkbox" checked={row.selected && !isSaved} disabled={!valid(row)} onChange={(event) => change(row.id, { selected: event.target.checked })} />{t('pasteSelected')}</label>
              <label>{t('date')}<input type="date" value={row.occurredOn} onChange={(event) => change(row.id, { occurredOn: event.target.value }, true)} /></label>
              <label>{t('payee')}<input value={row.payee} maxLength={80} onChange={(event) => change(row.id, { payee: event.target.value }, true)} /></label>
              <label>{t('transactionType')}<select aria-label={t('transactionType')} value={row.type} onChange={(event) => change(row.id, { type: event.target.value as Draft['type'], categoryId: null }, true)}><option value="expense">{t('expense')}</option><option value="income">{t('income')}</option></select></label>
              <label>{t('amount')} · {row.currency}<input inputMode="decimal" value={row.amountText} onChange={(event) => change(row.id, { amountText: event.target.value }, true)} /></label>
              <label>{t('category')}<select aria-label={t('category')} value={row.categoryId ?? ''} onChange={(event) => change(row.id, { categoryId: Number(event.target.value) || null }, true)}>
                <option value="">{t('pasteCategory')}</option>
                {props.categories.filter((item) => item.isActive && item.type === row.type).map((item) => <option key={item.id} value={item.id}>{localizeEntityName(item.name, item.localizationKey)}</option>)}
              </select></label>
              <button type="button" className="primary-button" disabled={!valid(row)} onClick={() => void approve([row])}>{t(isSaved ? 'pasteSaved' : 'pasteApprove')}</button>
            </fieldset>
            {state?.imported ? <p role="status">{t('pasteImported')}</p> : null}
            {!isSaved && hasWarning(row) ? <div className="paste-warning">
              <p>{row.flags.includes('POSSIBLE_TRANSFER') ? t('pasteTransfer') : t('pasteCheck')}</p>
              <ul>{row.flags.map((flag) => <li key={flag}>{t(flagMessages[flag])}</li>)}</ul>
              {!sourceHasExplicitYear(row.sourceText, row.occurredOn) ? <p>{t('pasteYear')}</p> : null}
              <label><input type="checkbox" disabled={locked} checked={row.checked} onChange={(event) => change(row.id, { checked: event.target.checked, selected: false })} />{t('pasteChecked')}</label>
            </div> : null}
            {!isSaved && state?.duplicate ? <label className="paste-warning"><input type="checkbox" disabled={locked} checked={row.duplicateConfirmed} onChange={(event) => change(row.id, { duplicateConfirmed: event.target.checked })} />{t('pasteDuplicate')}</label> : null}
            <details><summary>{t('pasteDetails')}</summary><p>{t(row.categorySource === 'history' ? 'pasteHistory' : 'pasteModel')}</p><blockquote>{row.sourceText}</blockquote></details>
          </article>
        })}
      </div>
      {drafts.length > 0 ? <div className="paste-footer"><span>{t('pasteSelectionHelp')}</span><button type="button" className="primary-button" disabled={locked || !selected.length || selected.some((row) => !valid(row))} onClick={() => void approve(selected)}>{t('pasteApproveSelected')} ({selected.length})</button></div> : <p>{t('pasteEmpty')}</p>}
      <div aria-live="polite">{receipts.map((item) => <p key={item.operationId}>{t(item.state === 'approved' ? 'pasteApproved' : item.state === 'undone' ? 'pasteUndone' : 'pasteInvalidated')} · {item.count} {item.state === 'approved' ? <button type="button" disabled={locked} onClick={() => void undo(item.operationId)}>{t('pasteUndo')}</button> : null}</p>)}</div>
      <details className="paste-more"><summary>{t('pasteMore')}</summary><button type="button" disabled={locked} onClick={() => setAdvanced(true)}>{t('pasteAdvanced')}</button></details>
    </section>
  )
}

const flagMessages: Record<BankImportDraft['flags'][number], MessageKey> = {
  UNCERTAIN_DATE: 'aiFlagUncertainDate', UNCERTAIN_AMOUNT: 'aiFlagUncertainAmount',
  UNCERTAIN_DIRECTION: 'aiFlagUncertainDirection', UNCERTAIN_CATEGORY: 'aiFlagUncertainCategory',
  POSSIBLE_DUPLICATE: 'aiFlagPossibleDuplicate', POSSIBLE_TRANSFER: 'aiFlagPossibleTransfer',
  NEEDS_REVIEW: 'aiFlagNeedsReview', RUNNING_BALANCE_MISMATCH: 'aiFlagRunningBalanceMismatch',
}
