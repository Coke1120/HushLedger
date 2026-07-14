import { ArrowRightLeft, LoaderCircle, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useI18n } from '../i18n'
import { currentHongKongDate, isValidCalendarDate } from '../lib/date'
import { confirmDiscardIfDirty, dialogLedgerContextChanged } from '../lib/dirtyDialog'
import { formatAmountInput, parseAmount } from '../lib/money'
import {
  accountTransferInputSchema,
  type Account,
  type AccountTransfer,
  type AccountTransferInput,
} from '../lib/schema'

type AccountTransferDialogProps = {
  accounts: Account[]
  ledgerContext: string
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
  ledgerContext,
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
  const transferableAccounts = useMemo(
    () => selectableAccounts.filter((source) => selectableAccounts.some(
      (destination) => destination.id !== source.id && destination.currency === source.currency,
    )),
    [selectableAccounts],
  )
  const initialFrom = transfer?.fromAccountId ?? transferableAccounts[0]?.id ?? 0
  const initialFromCurrency = selectableAccounts.find((account) => account.id === initialFrom)?.currency
  const initialTo = transfer?.toAccountId
    ?? selectableAccounts.find((account) => (
      account.id !== initialFrom && account.currency === initialFromCurrency
    ))?.id
    ?? 0
  const [fromAccountId, setFromAccountId] = useState(initialFrom)
  const [toAccountId, setToAccountId] = useState(initialTo)
  const [date, setDate] = useState(transfer?.occurredOn ?? currentHongKongDate().date)
  const [fromCleared, setFromCleared] = useState(transfer?.fromCleared ?? false)
  const [toCleared, setToCleared] = useState(transfer?.toCleared ?? false)
  const [localError, setLocalError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [openingLedgerContext] = useState(ledgerContext)
  const sourceAccount = selectableAccounts.find((account) => account.id === fromAccountId)
  const draftCurrency = sourceAccount?.currency ?? ledgerCurrency
  const destinationAccounts = selectableAccounts.filter((account) => (
    account.id !== fromAccountId && account.currency === draftCurrency
  ))
  const dialogRef = useRef<HTMLDivElement>(null)
  const amountRef = useRef<HTMLInputElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const draftIdRef = useRef(transfer?.id ?? crypto.randomUUID())
  const busyRef = useRef(saving)
  const dirtyRef = useRef(false)
  const busy = saving || deleting
  const ledgerContextChanged = available && online && dialogLedgerContextChanged(
    openingLedgerContext,
    ledgerContext,
  )
  const mutable = available && online && !ledgerContextChanged
  const closeIfSafe = useCallback(() => {
    confirmDiscardIfDirty(
      dirtyRef.current,
      () => window.confirm(t('discardUnsavedChangesConfirm')),
      onClose,
    )
  }, [onClose, t])

  useEffect(() => {
    busyRef.current = busy
  }, [busy])

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    document.body.classList.add('dialog-open')
    const focusFrame = requestAnimationFrame(() => amountRef.current?.focus())
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) {
        event.preventDefault()
        closeIfSafe()
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
  }, [closeIfSafe])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!mutable) return
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
      currency: draftCurrency,
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
    if (!mutable || !transfer || !window.confirm(t('deleteTransferConfirm'))) return
    setDeleting(true)
    if (await onDelete(transfer)) onClose()
    else setDeleting(false)
  }

  const changeSource = (nextId: number) => {
    setFromAccountId(nextId)
    const nextCurrency = selectableAccounts.find((account) => account.id === nextId)?.currency
    if (
      nextId === toAccountId
      || selectableAccounts.find((account) => account.id === toAccountId)?.currency !== nextCurrency
    ) {
      setToAccountId(selectableAccounts.find((account) => (
        account.id !== nextId && account.currency === nextCurrency
      ))?.id ?? 0)
    }
    setLocalError('')
  }
  const error = ledgerContextChanged ? t('draftLedgerChanged') : localError || serverError

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && !busy && closeIfSafe()}
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
          <button className="icon-button dialog-close" type="button" onClick={closeIfSafe} disabled={busy} aria-label={t('close')}>
            <X aria-hidden="true" />
          </button>
        </header>
        <form
          onSubmit={handleSubmit}
          onChange={() => { dirtyRef.current = true }}
          noValidate
          aria-busy={busy}
        >
          <fieldset className="transaction-form-fields" disabled={busy || !mutable}>
            <p className="transfer-form-help" id="transfer-form-help">
              <ArrowRightLeft aria-hidden="true" />
              {t('transferNotInReports')}
            </p>
            <div className="amount-field">
              <label htmlFor="transfer-amount">
                <span>{t('amount')}</span>
                <span className="amount-input-wrap">
                  <span>{draftCurrency}</span>
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
                  {transferableAccounts.map((account) => (
                    <option value={account.id} key={account.id}>
                      {accountLabel(account, localizeEntityName, t('inactive'))}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>{t('transferTo')}</span>
                <select value={toAccountId} onChange={(event) => setToAccountId(Number(event.target.value))} required>
                  {destinationAccounts.map((account) => (
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
              <textarea
                name="note"
                maxLength={200}
                rows={2}
                autoComplete="off"
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="none"
                defaultValue={transfer?.note}
                placeholder={t('transferNotePlaceholder')}
              />
            </label>
            {error ? <p className="form-error" id="transfer-form-error" role="alert">{error}</p> : null}
            {!available ? <p className="offline-form-note">{t('transferUnavailable')}</p> : null}
            <div className="dialog-actions transfer-dialog-actions">
              {transfer ? (
                <button className="button button-danger" type="button" disabled={!mutable || busy} onClick={() => void handleDelete()}>
                  {deleting ? <LoaderCircle className="spin" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
                  {deleting ? t('deleting') : t('delete')}
                </button>
              ) : null}
              <button className="button button-primary save-button" type="submit" disabled={!mutable || busy || destinationAccounts.length === 0}>
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
