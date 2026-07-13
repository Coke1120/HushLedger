import { ArrowRightLeft, LoaderCircle, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useI18n } from '../i18n'
import { currentHongKongDate, isValidCalendarDate } from '../lib/date'
import { formatAmountInput, parseAmount } from '../lib/money'
import {
  accountTransferInputSchema,
  type Account,
  type AccountTransfer,
  type AccountTransferInput,
} from '../lib/schema'

type AccountTransferDialogProps = {
  accounts: Account[]
  saving: boolean
  serverError: string
  online: boolean
  available: boolean
  transfer: AccountTransfer | null
  onClose: () => void
  onSubmit: (input: AccountTransferInput) => Promise<boolean>
  onDelete: (transfer: AccountTransfer) => Promise<boolean>
}

export function AccountTransferDialog({
  accounts,
  saving,
  serverError,
  online,
  available,
  transfer,
  onClose,
  onSubmit,
  onDelete,
}: AccountTransferDialogProps) {
  const { ledgerCurrency, locale, localizeEntityName, privacyMode, t } = useI18n()
  const selectableAccounts = useMemo(
    () => accounts.filter((account) => (
      account.isActive
      || account.id === transfer?.fromAccountId
      || account.id === transfer?.toAccountId
    )),
    [accounts, transfer],
  )
  const initialFrom = transfer?.fromAccountId ?? selectableAccounts[0]?.id ?? 0
  const initialTo = transfer?.toAccountId
    ?? selectableAccounts.find(({ id }) => id !== initialFrom)?.id
    ?? 0
  const [fromAccountId, setFromAccountId] = useState(initialFrom)
  const [toAccountId, setToAccountId] = useState(initialTo)
  const [date, setDate] = useState(transfer?.occurredOn ?? currentHongKongDate().date)
  const [fromCleared, setFromCleared] = useState(transfer?.fromCleared ?? false)
  const [toCleared, setToCleared] = useState(transfer?.toCleared ?? false)
  const [localError, setLocalError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const amountRef = useRef<HTMLInputElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const draftIdRef = useRef(transfer?.id ?? crypto.randomUUID())
  const busyRef = useRef(saving)
  const busy = saving || deleting

  useEffect(() => {
    busyRef.current = busy
  }, [busy])

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    document.body.classList.add('dialog-open')
    const focusFrame = requestAnimationFrame(() => amountRef.current?.focus())
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
      ))
      const first = focusable[0]
      const last = focusable.at(-1)
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', handleKeyDown)
      document.body.classList.remove('dialog-open')
      returnFocusRef.current?.focus()
    }
  }, [onClose])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLocalError('')
    const data = new FormData(event.currentTarget)
    if (!isValidCalendarDate(date)) {
      setLocalError(t('invalidDate'))
      return
    }

    let amountMinor: number
    try {
      amountMinor = parseAmount(String(data.get('amount') ?? ''), locale)
    } catch {
      setLocalError(t('invalidAmount'))
      return
    }

    const parsed = accountTransferInputSchema.safeParse({
      id: draftIdRef.current,
      amountMinor,
      currency: ledgerCurrency,
      fromAccountId,
      toAccountId,
      occurredOn: date,
      fromCleared,
      toCleared,
      note: String(data.get('note') ?? ''),
    })
    if (!parsed.success) {
      setLocalError(fromAccountId === toAccountId ? t('transferAccountSame') : t('invalidForm'))
      return
    }

    if (await onSubmit(parsed.data)) onClose()
  }

  const handleDelete = async () => {
    if (!transfer || !window.confirm(t('deleteTransferConfirm'))) return
    setDeleting(true)
    if (await onDelete(transfer)) onClose()
    else setDeleting(false)
  }

  const changeSource = (nextId: number) => {
    setFromAccountId(nextId)
    if (nextId === toAccountId) {
      setToAccountId(selectableAccounts.find(({ id }) => id !== nextId)?.id ?? 0)
    }
    setLocalError('')
  }
  const error = localError || serverError

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}
    >
      <div
        className="transaction-dialog transfer-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="transfer-dialog-title"
        aria-describedby={error ? 'transfer-form-error' : 'transfer-form-help'}
      >
        <div className="sheet-handle" aria-hidden="true" />
        <header className="dialog-header">
          <h2 id="transfer-dialog-title">{t(transfer ? 'editTransfer' : 'recordTransfer')}</h2>
          <button className="icon-button dialog-close" type="button" onClick={onClose} disabled={busy} aria-label={t('close')}>
            <X aria-hidden="true" />
          </button>
        </header>
        <form onSubmit={handleSubmit} noValidate aria-busy={busy}>
          <fieldset className="transaction-form-fields" disabled={busy}>
            <p className="transfer-form-help" id="transfer-form-help">
              <ArrowRightLeft aria-hidden="true" />
              {t('transferNotInReports')}
            </p>
            <div className="amount-field">
              <label htmlFor="transfer-amount">
                <span>{t('amount')}</span>
                <span className="amount-input-wrap">
                  <span>{ledgerCurrency}</span>
                  <input
                    id="transfer-amount"
                    aria-label={t('amount')}
                    ref={amountRef}
                    type={privacyMode ? 'password' : 'text'}
                    name="amount"
                    inputMode="decimal"
                    autoComplete="off"
                    maxLength={80}
                    placeholder={locale === 'fr' ? '0,00' : '0.00'}
                    defaultValue={transfer ? formatAmountInput(transfer.amountMinor, locale) : undefined}
                    required
                  />
                </span>
              </label>
            </div>
            <div className="form-grid transfer-account-grid">
              <label>
                <span>{t('transferFrom')}</span>
                <select value={fromAccountId} onChange={(event) => changeSource(Number(event.target.value))} required>
                  {selectableAccounts.map((account) => (
                    <option value={account.id} key={account.id}>
                      {accountLabel(account, localizeEntityName, t('inactive'))}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>{t('transferTo')}</span>
                <select value={toAccountId} onChange={(event) => setToAccountId(Number(event.target.value))} required>
                  {selectableAccounts.filter(({ id }) => id !== fromAccountId).map((account) => (
                    <option value={account.id} key={account.id}>
                      {accountLabel(account, localizeEntityName, t('inactive'))}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-date-field">
                <span>{t('date')}</span>
                <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
              </label>
            </div>
            <div className="transfer-clearing-grid" aria-label={t('transferPostingTitle')}>
              <label className="transaction-cleared-toggle">
                <input type="checkbox" checked={fromCleared} onChange={(event) => setFromCleared(event.target.checked)} />
                <span><strong>{t('transferLeftSource')}</strong><small>{t('transferLeftSourceHelp')}</small></span>
              </label>
              <label className="transaction-cleared-toggle">
                <input type="checkbox" checked={toCleared} onChange={(event) => setToCleared(event.target.checked)} />
                <span><strong>{t('transferReachedDestination')}</strong><small>{t('transferReachedDestinationHelp')}</small></span>
              </label>
            </div>
            <label>
              <span>{t('noteOptional')}</span>
              <textarea name="note" maxLength={200} rows={2} defaultValue={transfer?.note} placeholder={t('transferNotePlaceholder')} />
            </label>
            {error ? <p className="form-error" id="transfer-form-error" role="alert">{error}</p> : null}
            {!available ? <p className="offline-form-note">{t('transferUnavailable')}</p> : null}
            <div className="dialog-actions transfer-dialog-actions">
              {transfer ? (
                <button className="button button-danger" type="button" disabled={!available || busy} onClick={() => void handleDelete()}>
                  {deleting ? <LoaderCircle className="spin" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
                  {deleting ? t('deleting') : t('delete')}
                </button>
              ) : null}
              <button className="button button-primary save-button" type="submit" disabled={!available || !online || busy || selectableAccounts.length < 2}>
                {saving && !deleting ? <LoaderCircle className="spin" aria-hidden="true" /> : null}
                {saving && !deleting ? t('saving') : t(transfer ? 'saveChanges' : 'saveTransfer')}
              </button>
            </div>
          </fieldset>
        </form>
      </div>
    </div>
  )
}

function accountLabel(
  account: Account,
  localize: (name: string, key: Account['localizationKey']) => string,
  inactive: string,
) {
  const name = localize(account.name, account.localizationKey)
  return account.isActive ? name : `${name} (${inactive})`
}
