import { ArrowRightLeft, LoaderCircle, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useI18n } from '../i18n'
import { currentHongKongDate, isValidCalendarDate } from '../lib/date'
import { confirmDiscardIfDirty, dialogLedgerContextChanged } from '../lib/dirtyDialog'
import { formatAmountInput, parseAmount } from '../lib/money'
import {
  recurringTransferRuleCreateSchema,
  recurringTransferRuleUpdateSchema,
  type Account,
  type RecurrenceFrequency,
  type RecurringTransferRule,
  type RecurringTransferRuleCreateInput,
  type RecurringTransferRuleUpdateInput,
} from '../lib/schema'

type RecurringTransferRuleDialogProps = {
  accounts: Account[]
  ledgerContext: string
  mutable: boolean
  rule: RecurringTransferRule | null
  saving: boolean
  serverError: string
  onClose: () => void
  onCreate: (input: RecurringTransferRuleCreateInput) => Promise<boolean>
  onEdit: (id: string, input: RecurringTransferRuleUpdateInput) => Promise<boolean>
}

export function RecurringTransferRuleDialog({
  accounts,
  ledgerContext,
  mutable,
  rule,
  saving,
  serverError,
  onClose,
  onCreate,
  onEdit,
}: RecurringTransferRuleDialogProps) {
  const {
    formatMoney,
    ledgerCurrency,
    locale,
    localizeEntityName,
    privacyMode,
    t,
  } = useI18n()
  const selectableAccounts = useMemo(
    () => accounts.filter((account) => (
      account.isActive
      || account.id === rule?.fromAccountId
      || account.id === rule?.toAccountId
    )),
    [accounts, rule],
  )
  const initialFrom = rule?.fromAccountId ?? selectableAccounts[0]?.id ?? 0
  const initialTo = rule?.toAccountId
    ?? selectableAccounts.find(({ id }) => id !== initialFrom)?.id
    ?? 0
  const [fromAccountId, setFromAccountId] = useState(initialFrom)
  const [toAccountId, setToAccountId] = useState(initialTo)
  const [frequency, setFrequency] = useState<RecurrenceFrequency>(rule?.frequency ?? 'monthly')
  const [scheduleDate, setScheduleDate] = useState(
    rule?.scheduleStartsOn ?? currentHongKongDate().date,
  )
  const [scheduleEndDate, setScheduleEndDate] = useState(rule?.scheduleEndsOn ?? '')
  const [isActive, setIsActive] = useState(rule?.isActive ?? true)
  const [localError, setLocalError] = useState('')
  const [openingLedgerContext] = useState(ledgerContext)
  const [draftCurrency] = useState(ledgerCurrency)
  const dialogRef = useRef<HTMLDivElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const draftIdRef = useRef(rule?.id ?? crypto.randomUUID())
  const savingRef = useRef(saving)
  const dirtyRef = useRef(false)
  const ledgerContextChanged = mutable && dialogLedgerContextChanged(
    openingLedgerContext,
    ledgerContext,
  )
  const draftMutable = mutable && !ledgerContextChanged
  const frequencyLabels: Record<RecurrenceFrequency, string> = {
    daily: t('daily'),
    weekly: t('weekly'),
    monthly: t('monthly'),
    yearly: t('yearly'),
  }
  const anchorHelpId = frequency === 'monthly'
    ? 'scheduled-transfer-monthly-note'
    : frequency === 'yearly'
      ? 'scheduled-transfer-yearly-note'
      : undefined
  const closeIfSafe = useCallback(() => {
    confirmDiscardIfDirty(
      dirtyRef.current,
      () => window.confirm(t('discardUnsavedChangesConfirm')),
      onClose,
    )
  }, [onClose, t])

  useEffect(() => {
    savingRef.current = saving
  }, [saving])

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
    const focusFrame = requestAnimationFrame(() => nameRef.current?.focus())
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !savingRef.current) {
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

  const changeSource = (nextId: number) => {
    setFromAccountId(nextId)
    if (nextId === toAccountId) {
      setToAccountId(selectableAccounts.find(({ id }) => id !== nextId)?.id ?? 0)
    }
    setLocalError('')
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!draftMutable) return
    setLocalError('')
    const data = new FormData(event.currentTarget)

    if (!isValidCalendarDate(scheduleDate)) {
      setLocalError(t('invalidDate'))
      return
    }
    if (
      scheduleEndDate
      && (!isValidCalendarDate(scheduleEndDate) || scheduleEndDate < scheduleDate)
    ) {
      setLocalError(t('scheduleEndDateInvalid'))
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
      amountMinor,
      currency: draftCurrency,
      fromAccountId,
      toAccountId,
      frequency,
      scheduleStartsOn: scheduleDate,
      scheduleEndsOn: scheduleEndDate || null,
      isActive,
      note: String(data.get('note') ?? ''),
    }
    const parsed = rule
      ? recurringTransferRuleUpdateSchema.safeParse({ ...fields, revision: rule.revision })
      : recurringTransferRuleCreateSchema.safeParse({ id: draftIdRef.current, ...fields })
    if (!parsed.success) {
      setLocalError(
        fromAccountId === toAccountId ? t('transferAccountSame') : t('invalidForm'),
      )
      return
    }

    const saved = rule
      ? await onEdit(rule.id, parsed.data as RecurringTransferRuleUpdateInput)
      : await onCreate(parsed.data as RecurringTransferRuleCreateInput)
    if (saved) onClose()
  }

  const error = ledgerContextChanged ? t('draftLedgerChanged') : localError || serverError
  const describedBy = [
    'scheduled-transfer-ledger-help',
    'scheduled-transfer-funds-help',
    'scheduled-transfer-end-help',
    anchorHelpId ?? '',
    error ? 'scheduled-transfer-form-error' : '',
  ].filter(Boolean).join(' ')

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && !saving && closeIfSafe()}
    >
      <div
        className="transaction-dialog recurring-rule-dialog recurring-transfer-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="scheduled-transfer-dialog-title"
        aria-describedby={describedBy}
      >
        <div className="sheet-handle" aria-hidden="true" />
        <header className="dialog-header">
          <h2 id="scheduled-transfer-dialog-title">
            {t(rule ? 'editScheduledTransfer' : 'addScheduledTransfer')}
          </h2>
          <button className="icon-button dialog-close" type="button" onClick={closeIfSafe} disabled={saving} aria-label={t('close')}>
            <X aria-hidden="true" />
          </button>
        </header>

        <form onSubmit={handleSubmit} onChange={() => { dirtyRef.current = true }} noValidate aria-busy={saving}>
          <fieldset className="transaction-form-fields" disabled={saving || !draftMutable}>
            <p className="transfer-form-help" id="scheduled-transfer-ledger-help">
              <ArrowRightLeft aria-hidden="true" />
              {t('scheduledTransferLedgerOnlyHelp')}
            </p>

            <label>
              <span>{t('name')}</span>
              <input
                ref={nameRef}
                name="name"
                maxLength={80}
                defaultValue={rule?.name ?? ''}
                placeholder={t('scheduledTransferNameExample')}
                required
              />
            </label>

            <label className="amount-field recurring-amount-field">
              <span>{t('recurringAmount')}</span>
              <span className="amount-input-wrap">
                <span>{draftCurrency}</span>
                <input
                  type={privacyMode ? 'password' : 'text'}
                  name="amount"
                  inputMode="decimal"
                  autoComplete="off"
                  defaultValue={rule ? formatAmountInput(rule.amountMinor, locale) : ''}
                  placeholder={locale === 'fr' ? '0,00' : '0.00'}
                  pattern={locale === 'fr' ? '[0-9]+([,][0-9]{1,2})?' : '[0-9]+([.][0-9]{1,2})?'}
                  aria-invalid={Boolean(error)}
                  required
                />
              </span>
              {rule ? <small>{t('currentAmount', { amount: formatMoney(rule.amountMinor, rule.currency) })}</small> : null}
            </label>

            <div className="form-grid recurring-form-grid">
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
              <label>
                <span>{t('frequency')}</span>
                <select value={frequency} aria-describedby={anchorHelpId} onChange={(event) => setFrequency(event.target.value as RecurrenceFrequency)}>
                  {Object.entries(frequencyLabels).map(([value, label]) => (
                    <option value={value} key={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>{rule ? t('scheduleBaseDate') : t('firstGenerationDate')}</span>
                <input type="date" value={scheduleDate} onChange={(event) => setScheduleDate(event.target.value)} required />
              </label>
              <label>
                <span>{t('scheduleEndDateOptional')}</span>
                <input
                  type="date"
                  min={scheduleDate}
                  value={scheduleEndDate}
                  aria-describedby="scheduled-transfer-end-help"
                  onChange={(event) => setScheduleEndDate(event.target.value)}
                />
              </label>
            </div>

            <p className="schedule-note" id="scheduled-transfer-end-help">
              {t('scheduledTransferEndDateHelp')}
            </p>
            {frequency === 'monthly' ? <p className="schedule-note" id="scheduled-transfer-monthly-note">{t('monthlyAnchorHelp')}</p> : null}
            {frequency === 'yearly' ? <p className="schedule-note" id="scheduled-transfer-yearly-note">{t('yearlyAnchorHelp')}</p> : null}

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
                defaultValue={rule?.note ?? ''}
                placeholder={t('transferNotePlaceholder')}
              />
            </label>

            <label className="active-toggle">
              <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
              <span>
                <strong>{t('enableAutomaticGeneration')}</strong>
                <small>{t('scheduledTransferAutomaticHelp')}</small>
              </span>
            </label>

            <p className="schedule-note" id="scheduled-transfer-funds-help">
              {t('scheduledTransferConfirmFundsHelp')}
            </p>
            <p className="schedule-note">{t('scheduledTransferHistoryHelp')}</p>

            {error ? <p className="form-error" id="scheduled-transfer-form-error" role="alert">{error}</p> : null}
            {!mutable ? <p className="offline-form-note">{t('scheduledTransferOfflineForm')}</p> : null}

            <div className="dialog-actions">
              <button className="button button-primary save-button" type="submit" disabled={saving || !draftMutable || selectableAccounts.length < 2}>
                {saving ? <LoaderCircle className="spin" aria-hidden="true" /> : null}
                {saving ? t('saving') : rule ? t('saveChanges') : t('createScheduledTransfer')}
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
