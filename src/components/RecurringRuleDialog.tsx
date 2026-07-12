import { ArrowDownRight, ArrowUpRight, LoaderCircle, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useI18n } from '../i18n'
import { currentHongKongDate, isValidCalendarDate } from '../lib/date'
import { parseAmount } from '../lib/money'
import {
  recurringRuleCreateSchema,
  recurringRuleUpdateSchema,
  type Account,
  type Category,
  type RecurrenceFrequency,
  type RecurringRule,
  type RecurringRuleCreateInput,
  type RecurringRuleUpdateInput,
  type TransactionType,
} from '../lib/schema'

type RecurringRuleDialogProps = {
  rule: RecurringRule | null
  accounts: Account[]
  categories: Category[]
  saving: boolean
  serverError: string
  online: boolean
  onClose: () => void
  onCreate: (input: RecurringRuleCreateInput) => Promise<boolean>
  onEdit: (id: string, input: RecurringRuleUpdateInput) => Promise<boolean>
}

export function RecurringRuleDialog({
  rule,
  accounts,
  categories,
  saving,
  serverError,
  online,
  onClose,
  onCreate,
  onEdit,
}: RecurringRuleDialogProps) {
  const { formatDate, formatMoney, locale, localizeEntityName, t } = useI18n()
  const editing = Boolean(rule)
  const selectableAccounts = useMemo(
    () => accounts.filter((account) => account.isActive || account.id === rule?.accountId),
    [accounts, rule?.accountId],
  )
  const [type, setType] = useState<TransactionType>(rule?.type ?? 'expense')
  const [accountId, setAccountId] = useState(rule?.accountId ?? selectableAccounts[0]?.id ?? 0)
  const [categoryId, setCategoryId] = useState(
    rule?.categoryId
      ?? categories.find((category) => category.isActive && category.type === 'expense')?.id
      ?? 0,
  )
  const [frequency, setFrequency] = useState<RecurrenceFrequency>(rule?.frequency ?? 'monthly')
  const [scheduleDate, setScheduleDate] = useState(rule?.scheduleStartsOn ?? currentHongKongDate().date)
  const [isActive, setIsActive] = useState(rule?.isActive ?? true)
  const [localError, setLocalError] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const draftIdRef = useRef(crypto.randomUUID())
  const savingRef = useRef(saving)

  const matchingCategories = useMemo(
    () => categories.filter(
      (category) =>
        category.type === type
        && (category.isActive || category.id === rule?.categoryId),
    ),
    [categories, rule?.categoryId, type],
  )
  const frequencyLabels: Record<RecurrenceFrequency, string> = {
    daily: t('daily'),
    weekly: t('weekly'),
    monthly: t('monthly'),
  }

  useEffect(() => {
    savingRef.current = saving
  }, [saving])

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    document.body.classList.add('dialog-open')

    const focusFrame = requestAnimationFrame(() => nameRef.current?.focus())
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

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLocalError('')
    const data = new FormData(event.currentTarget)

    if (!isValidCalendarDate(scheduleDate)) {
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

    const fields = {
        name: String(data.get('name') ?? ''),
        type,
        amountMinor,
        currency: 'HKD' as const,
        accountId,
        categoryId: matchingCategories.some((category) => category.id === categoryId)
          ? categoryId
          : (matchingCategories[0]?.id ?? 0),
        frequency,
        scheduleStartsOn: scheduleDate,
        isActive,
        payee: String(data.get('payee') ?? ''),
        note: String(data.get('note') ?? ''),
      }
    const parsed = rule
      ? recurringRuleUpdateSchema.safeParse({ ...fields, revision: rule.revision })
      : recurringRuleCreateSchema.safeParse({ id: draftIdRef.current, ...fields })
    if (!parsed.success) {
      setLocalError(t('invalidForm'))
      return
    }

    const saved = rule
      ? await onEdit(rule.id, parsed.data as RecurringRuleUpdateInput)
      : await onCreate(parsed.data as RecurringRuleCreateInput)
    if (saved) onClose()
  }

  const error = localError || serverError
  const describedBy = [
    'recurring-future-note',
    frequency === 'monthly' ? 'recurring-monthly-note' : '',
    error ? 'recurring-form-error' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}
    >
      <div
        className="transaction-dialog recurring-rule-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="recurring-dialog-title"
        aria-describedby={describedBy}
      >
        <div className="sheet-handle" aria-hidden="true" />
        <header className="dialog-header">
          <h2 id="recurring-dialog-title">{editing ? t('editRecurringRule') : t('addRecurringRule')}</h2>
          <button className="icon-button dialog-close" type="button" onClick={onClose} disabled={saving} aria-label={t('close')}>
            <X aria-hidden="true" />
          </button>
        </header>

        <form onSubmit={handleSubmit} noValidate>
          <label>
            <span>{t('name')}</span>
            <input
              ref={nameRef}
              name="name"
              maxLength={80}
              defaultValue={rule?.name ?? ''}
              placeholder={t('recurringNameExample')}
              required
            />
          </label>

          <div className="type-switch" role="group" aria-label={t('transactionType')}>
            <button
              type="button"
              className={type === 'expense' ? 'is-active expense' : undefined}
              aria-pressed={type === 'expense'}
              onClick={() => selectType('expense')}
            >
              <ArrowDownRight aria-hidden="true" />
              {t('expense')}
            </button>
            <button
              type="button"
              className={type === 'income' ? 'is-active income' : undefined}
              aria-pressed={type === 'income'}
              onClick={() => selectType('income')}
            >
              <ArrowUpRight aria-hidden="true" />
              {t('income')}
            </button>
          </div>

          <label className="amount-field recurring-amount-field">
            <span>{t('recurringAmount')}</span>
            <span className="amount-input-wrap">
              <span>HK$</span>
              <input
                name="amount"
                inputMode="decimal"
                autoComplete="off"
                defaultValue={rule ? (rule.amountMinor / 100).toFixed(2).replace('.', locale === 'fr' ? ',' : '.') : ''}
                placeholder={locale === 'fr' ? '0,00' : '0.00'}
                pattern={locale === 'fr' ? '[0-9]+([,][0-9]{1,2})?' : '[0-9]+([.][0-9]{1,2})?'}
                aria-invalid={Boolean(error)}
                required
              />
            </span>
            {rule ? <small>{t('currentAmount', { amount: formatMoney(rule.amountMinor) })}</small> : null}
          </label>

          <div className="form-grid recurring-form-grid">
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
            <label>
              <span>{t('frequency')}</span>
              <select value={frequency} onChange={(event) => setFrequency(event.target.value as RecurrenceFrequency)}>
                {Object.entries(frequencyLabels).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{editing ? t('scheduleBaseDate') : t('firstGenerationDate')}</span>
              <input
                type="date"
                value={scheduleDate}
                onChange={(event) => setScheduleDate(event.target.value)}
                required
              />
            </label>
          </div>

          {frequency === 'monthly' ? (
            <p className="schedule-note" id="recurring-monthly-note">
              {t('monthlyAnchorHelp')}
            </p>
          ) : null}

          {rule ? (
            <p className="schedule-note">{t('nextGenerationHelp', { date: formatDate(rule.nextOccurrenceOn) })}</p>
          ) : null}

          <label>
            <span>{t('payee')}</span>
            <input name="payee" maxLength={80} defaultValue={rule?.payee ?? ''} placeholder={t('recurringPayeeExample')} />
          </label>
          <label>
            <span>{t('noteOptional')}</span>
            <textarea name="note" maxLength={200} rows={2} defaultValue={rule?.note ?? ''} placeholder={t('notePlaceholder')} />
          </label>

          <label className="active-toggle">
            <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
            <span>
              <strong>{t('enableAutomaticGeneration')}</strong>
              <small>{t('automaticGenerationHelp')}</small>
            </span>
          </label>

          <p className="schedule-note" id="recurring-future-note">
            {t('recurringHistoryHelp')}
          </p>

          {error ? (
            <p className="form-error" id="recurring-form-error" role="alert">
              {error}
            </p>
          ) : null}

          {!online ? <p className="offline-form-note">{t('offlineRecurringForm')}</p> : null}

          <div className="dialog-actions">
            <button className="button button-primary save-button" type="submit" disabled={saving || !online}>
              {saving ? <LoaderCircle className="spin" aria-hidden="true" /> : null}
              {saving ? t('saving') : editing ? t('saveChanges') : t('createRecurringRule')}
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
