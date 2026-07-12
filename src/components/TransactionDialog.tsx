import { ArrowDownRight, ArrowUpRight, CopyPlus, LoaderCircle, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useI18n } from '../i18n'
import { api } from '../lib/api'
import { currentHongKongDate, isValidCalendarDate } from '../lib/date'
import { formatAmountInput, parseAmount } from '../lib/money'
import { payeeOptions, rememberPayeeReferences } from '../lib/payeeMemory'
import {
  transactionInputSchema,
  type Account,
  type Category,
  type PayeeSuggestion,
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
  draft: TransactionInput | null
  onClose: () => void
  onSubmit: (input: TransactionInput) => Promise<boolean>
  onDelete: (transaction: Transaction) => Promise<boolean>
  onDuplicate: (transaction: Transaction) => void
}

export function TransactionDialog({
  accounts,
  categories,
  saving,
  serverError,
  online,
  transaction,
  draft,
  onClose,
  onSubmit,
  onDelete,
  onDuplicate,
}: TransactionDialogProps) {
  const { locale, localizeEntityName, privacyMode, t } = useI18n()
  const initialTransaction = transaction ?? draft
  const selectableAccounts = useMemo(
    () => accounts.filter((account) => account.isActive || account.id === transaction?.accountId),
    [accounts, transaction?.accountId],
  )
  const [type, setType] = useState<TransactionType>(initialTransaction?.type ?? 'expense')
  const [accountId, setAccountId] = useState(initialTransaction?.accountId ?? selectableAccounts[0]?.id ?? 0)
  const [categoryId, setCategoryId] = useState(
    initialTransaction?.categoryId
      ?? categories.find((category) => category.isActive && category.type === 'expense')?.id
      ?? 0,
  )
  const [date, setDate] = useState(initialTransaction?.occurredOn ?? currentHongKongDate().date)
  const [payee, setPayee] = useState(initialTransaction?.payee ?? '')
  const [suggestions, setSuggestions] = useState<PayeeSuggestion[]>([])
  const [payeeMemoryApplied, setPayeeMemoryApplied] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [localError, setLocalError] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)
  const amountRef = useRef<HTMLInputElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const draftIdRef = useRef(initialTransaction?.id ?? crypto.randomUUID())
  const savingRef = useRef(saving)
  const accountChangedRef = useRef(false)
  const categoryChangedRef = useRef(false)
  const payeeRef = useRef(payee)
  const typeRef = useRef(type)

  const matchingCategories = useMemo(
    () => categories.filter(
      (category) =>
        category.type === type
        && (category.isActive || category.id === transaction?.categoryId),
    ),
    [categories, transaction?.categoryId, type],
  )
  const suggestedPayees = useMemo(() => payeeOptions(suggestions, type), [suggestions, type])
  const canDuplicate = Boolean(
    transaction
    && accounts.some((account) => account.id === transaction.accountId && account.isActive)
    && categories.some((category) => category.id === transaction.categoryId && category.isActive),
  )

  const applyPayeeMemory = useCallback((
    nextPayee: string,
    nextType: TransactionType,
    nextSuggestions: readonly PayeeSuggestion[],
  ) => {
    if (transaction || draft) return
    const remembered = rememberPayeeReferences(
      nextSuggestions,
      nextPayee,
      nextType,
      accounts,
      categories,
    )
    if (!remembered) {
      setPayeeMemoryApplied(false)
      return
    }

    const applyAccount = !accountChangedRef.current && remembered.accountId !== null
    const applyCategory = !categoryChangedRef.current && remembered.categoryId !== null
    if (applyAccount) setAccountId(remembered.accountId ?? 0)
    if (applyCategory) setCategoryId(remembered.categoryId ?? 0)
    setPayeeMemoryApplied(applyAccount || applyCategory)
  }, [accounts, categories, draft, transaction])

  useEffect(() => {
    savingRef.current = saving
  }, [saving])

  useEffect(() => {
    if (transaction || draft || !online) return
    let active = true
    void api<PayeeSuggestion[]>('/api/payee-suggestions')
      .then((items) => {
        if (!active) return
        setSuggestions(items)
        applyPayeeMemory(payeeRef.current, typeRef.current, items)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [applyPayeeMemory, draft, online, transaction])

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
    typeRef.current = nextType
    setType(nextType)
    categoryChangedRef.current = false
    setCategoryId(
      categories.find((category) => category.isActive && category.type === nextType)?.id ?? 0,
    )
    setLocalError('')
    setPayeeMemoryApplied(false)
    applyPayeeMemory(payeeRef.current, nextType, suggestions)
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
          <h2 id="transaction-dialog-title">{t(transaction ? 'editTransaction' : draft ? 'duplicateTransaction' : 'addTransaction')}</h2>
          <button className="icon-button dialog-close" type="button" onClick={onClose} disabled={saving} aria-label={t('close')}>
            <X aria-hidden="true" />
          </button>
        </header>

        <form onSubmit={handleSubmit} noValidate>
          {draft ? <p className="duplicate-form-note">{t('duplicateReviewHelp')}</p> : null}
          {transaction && !canDuplicate ? (
            <p className="duplicate-form-note">{t('duplicateUnavailableHelp')}</p>
          ) : null}

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
                type={privacyMode ? 'password' : 'text'}
                name="amount"
                inputMode="decimal"
                autoComplete="off"
                placeholder={locale === 'fr' ? '0,00' : '0.00'}
                pattern={locale === 'fr' ? '[0-9]+([,][0-9]{1,2})?' : '[0-9]+([.][0-9]{1,2})?'}
                defaultValue={initialTransaction ? formatAmountInput(initialTransaction.amountMinor, locale) : undefined}
                aria-invalid={Boolean(error)}
                required
              />
            </span>
          </label>

          <div className="form-grid">
            <label>
              <span>{t('account')}</span>
              <select
                value={accountId}
                onChange={(event) => {
                  accountChangedRef.current = true
                  setAccountId(Number(event.target.value))
                  setPayeeMemoryApplied(false)
                }}
                required
              >
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
              <select
                value={categoryId}
                onChange={(event) => {
                  categoryChangedRef.current = true
                  setCategoryId(Number(event.target.value))
                  setPayeeMemoryApplied(false)
                }}
                required
              >
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
              value={payee}
              onChange={(event) => {
                const nextPayee = event.target.value
                payeeRef.current = nextPayee
                setPayee(nextPayee)
                applyPayeeMemory(nextPayee, typeRef.current, suggestions)
              }}
              list={transaction || draft || suggestedPayees.length === 0 ? undefined : 'payee-suggestions'}
              aria-describedby={!transaction && !draft && suggestedPayees.length > 0 ? 'payee-suggestion-help' : undefined}
              placeholder={type === 'expense' ? t('expensePayeeExample') : t('incomePayeeExample')}
            />
            {!transaction && !draft && suggestedPayees.length > 0 ? (
              <small
                className={`payee-suggestion-help${payeeMemoryApplied ? ' is-applied' : ''}`}
                id="payee-suggestion-help"
              >
                {t(payeeMemoryApplied ? 'payeeMemoryApplied' : 'payeeSuggestionsHelp')}
              </small>
            ) : null}
            {!transaction && !draft && suggestedPayees.length > 0 ? (
              <datalist id="payee-suggestions">
                {suggestedPayees.map((suggestedPayee) => (
                  <option value={suggestedPayee} key={suggestedPayee} />
                ))}
              </datalist>
            ) : null}
          </label>
          <label>
            <span>{t('noteOptional')}</span>
            <textarea
              name="note"
              maxLength={200}
              rows={2}
              defaultValue={initialTransaction?.note}
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
            {transaction ? (
              <button
                className="button button-secondary"
                type="button"
                disabled={saving || !online || !canDuplicate}
                onClick={() => onDuplicate(transaction)}
              >
                <CopyPlus aria-hidden="true" />
                {t('duplicate')}
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
