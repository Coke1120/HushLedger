import { ArrowDownRight, ArrowUpRight, LoaderCircle, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useI18n } from '../i18n'
import { currentHongKongDate, isValidCalendarDate } from '../lib/date'
import { formatAmountInput, parseAmount } from '../lib/money'
import {
  transactionInputSchema,
  type Account,
  type Category,
  type Transaction,
  type TransactionInput,
  type TransactionType,
} from '../lib/schema'

type TransactionDialogProps = {
  accounts: Account[]
  categories: Category[]
  saving: boolean
  serverError: string
  online: boolean
  transaction: Transaction | null
  onClose: () => void
  onSubmit: (input: TransactionInput) => Promise<boolean>
  onDelete: (transaction: Transaction) => Promise<boolean>
}

export function TransactionDialog({
  accounts,
  categories,
  saving,
  serverError,
  online,
  transaction,
  onClose,
  onSubmit,
  onDelete,
}: TransactionDialogProps) {
  const { locale, localizeEntityName, t } = useI18n()
  const selectableAccounts = useMemo(
    () => accounts.filter((account) => account.isActive || account.id === transaction?.accountId),
    [accounts, transaction?.accountId],
  )
  const [type, setType] = useState<TransactionType>(transaction?.type ?? 'expense')
  const [accountId, setAccountId] = useState(transaction?.accountId ?? selectableAccounts[0]?.id ?? 0)
  const [categoryId, setCategoryId] = useState(
    transaction?.categoryId
      ?? categories.find((category) => category.isActive && category.type === 'expense')?.id
      ?? 0,
  )
  const [date, setDate] = useState(transaction?.occurredOn ?? currentHongKongDate().date)
  const [deleting, setDeleting] = useState(false)
  const [localError, setLocalError] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)
  const amountRef = useRef<HTMLInputElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const draftIdRef = useRef(transaction?.id ?? crypto.randomUUID())
  const savingRef = useRef(saving)

  const matchingCategories = useMemo(
    () => categories.filter(
      (category) =>
        category.type === type
        && (category.isActive || category.id === transaction?.categoryId),
    ),
    [categories, transaction?.categoryId, type],
  )

  useEffect(() => {
    savingRef.current = saving
  }, [saving])

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    document.body.classList.add('dialog-open')

    const focusFrame = requestAnimationFrame(() => amountRef.current?.focus())
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !savingRef.current) {
        event.preventDefault()
        onClose()
        return
      }

      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
        ),
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
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

  const selectType = (nextType: TransactionType) => {
    setType(nextType)
    setCategoryId(
      categories.find((category) => category.isActive && category.type === nextType)?.id ?? 0,
    )
    setLocalError('')
  }

  const handleBackdropKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !saving) onClose()
  }

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

    const parsed = transactionInputSchema.safeParse({
      id: draftIdRef.current,
      type,
      amountMinor,
      currency: 'HKD',
      accountId,
      categoryId: matchingCategories.some((category) => category.id === categoryId)
        ? categoryId
        : (matchingCategories[0]?.id ?? 0),
      occurredOn: date,
      payee: String(data.get('payee') ?? ''),
      note: String(data.get('note') ?? ''),
    })
    if (!parsed.success) {
      setLocalError(t('invalidForm'))
      return
    }

    const saved = await onSubmit(parsed.data)
    if (saved) onClose()
  }

  const handleDelete = async () => {
    if (!transaction || !window.confirm(t('deleteTransactionConfirm'))) return
    setDeleting(true)
    const deleted = await onDelete(transaction)
    if (deleted) onClose()
    else setDeleting(false)
  }

  const error = localError || serverError

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}
      onKeyDown={handleBackdropKeyDown}
    >
      <div
        className="transaction-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="transaction-dialog-title"
        aria-describedby={error ? 'transaction-form-error' : undefined}
      >
        <div className="sheet-handle" aria-hidden="true" />
        <header className="dialog-header">
          <h2 id="transaction-dialog-title">{t(transaction ? 'editTransaction' : 'addTransaction')}</h2>
          <button className="icon-button dialog-close" type="button" onClick={onClose} disabled={saving} aria-label={t('close')}>
            <X aria-hidden="true" />
          </button>
        </header>

        <form onSubmit={handleSubmit} noValidate>
          <div className="type-switch" role="group" aria-label={t('transactionType')}>
            <button type="button" className={type === 'expense' ? 'is-active expense' : undefined} aria-pressed={type === 'expense'} onClick={() => selectType('expense')}>
              <ArrowDownRight aria-hidden="true" />
              {t('expense')}
            </button>
            <button type="button" className={type === 'income' ? 'is-active income' : undefined} aria-pressed={type === 'income'} onClick={() => selectType('income')}>
              <ArrowUpRight aria-hidden="true" />
              {t('income')}
            </button>
          </div>

          <label className="amount-field">
            <span>{t('amount')}</span>
            <span className="amount-input-wrap">
              <span>HK$</span>
              <input
                ref={amountRef}
                name="amount"
                inputMode="decimal"
                autoComplete="off"
                placeholder={locale === 'fr' ? '0,00' : '0.00'}
                pattern={locale === 'fr' ? '[0-9]+([,][0-9]{1,2})?' : '[0-9]+([.][0-9]{1,2})?'}
                defaultValue={transaction ? formatAmountInput(transaction.amountMinor, locale) : undefined}
                aria-invalid={Boolean(error)}
                required
              />
            </span>
          </label>

          <div className="form-grid">
            <label>
              <span>{t('account')}</span>
              <select value={accountId} onChange={(event) => setAccountId(Number(event.target.value))} required>
                {selectableAccounts.map((account) => (
                  <option value={account.id} key={account.id}>
                    {referenceOptionLabel(
                      localizeEntityName(account.name, account.localizationKey),
                      account.isActive,
                      t('inactive'),
                    )}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{t('category')}</span>
              <select value={categoryId} onChange={(event) => setCategoryId(Number(event.target.value))} required>
                {matchingCategories.map((category) => (
                  <option value={category.id} key={category.id}>
                    {referenceOptionLabel(
                      localizeEntityName(category.name, category.localizationKey),
                      category.isActive,
                      t('inactive'),
                    )}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-date-field">
              <span>{t('date')}</span>
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
            </label>
          </div>

          <label>
            <span>{t('payee')}</span>
            <input
              name="payee"
              maxLength={80}
              defaultValue={transaction?.payee}
              placeholder={type === 'expense' ? t('expensePayeeExample') : t('incomePayeeExample')}
            />
          </label>
          <label>
            <span>{t('noteOptional')}</span>
            <textarea
              name="note"
              maxLength={200}
              rows={2}
              defaultValue={transaction?.note}
              placeholder={t('notePlaceholder')}
            />
          </label>

          {error ? (
            <p className="form-error" id="transaction-form-error" role="alert">
              {error}
            </p>
          ) : null}

          {!online ? <p className="offline-form-note">{t('offlineTransactionForm')}</p> : null}

          <div className="dialog-actions">
            {transaction ? (
              <button
                className="button button-danger"
                type="button"
                disabled={saving || !online}
                onClick={() => void handleDelete()}
              >
                {deleting ? <LoaderCircle className="spin" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
                {deleting ? t('deleting') : t('delete')}
              </button>
            ) : null}
            <button className="button button-primary save-button" type="submit" disabled={saving || !online}>
              {saving && !deleting ? <LoaderCircle className="spin" aria-hidden="true" /> : null}
              {saving && !deleting ? t('saving') : t(transaction ? 'saveChanges' : 'saveTransaction')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function referenceOptionLabel(name: string, active: boolean, inactiveLabel: string) {
  return active ? name : `${name} (${inactiveLabel})`
}
