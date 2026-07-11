import { ArrowDownRight, ArrowUpRight, LoaderCircle, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { currentHongKongDate, formatHongKongDate, isValidCalendarDate } from '../lib/date'
import { formatMoney, parseAmount } from '../lib/money'
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

function validationMessage(error: unknown) {
  if (typeof error === 'object' && error !== null && 'issues' in error) {
    const issues = (error as { issues?: Array<{ message?: string }> }).issues
    if (issues?.[0]?.message) return issues[0].message
  }
  return error instanceof Error ? error.message : '資料不正確，請檢查後再試。'
}

const frequencyLabels: Record<RecurrenceFrequency, string> = {
  daily: '每日',
  weekly: '每週',
  monthly: '每月',
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
  const editing = Boolean(rule)
  const [type, setType] = useState<TransactionType>(rule?.type ?? 'expense')
  const [accountId, setAccountId] = useState(rule?.accountId ?? accounts[0]?.id ?? 0)
  const [categoryId, setCategoryId] = useState(
    rule?.categoryId ?? categories.find((category) => category.type === 'expense')?.id ?? 0,
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

  const matchingCategories = useMemo(() => categories.filter((category) => category.type === type), [categories, type])

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
    setCategoryId(categories.find((category) => category.type === nextType)?.id ?? 0)
    setLocalError('')
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLocalError('')
    const data = new FormData(event.currentTarget)

    try {
      if (!isValidCalendarDate(scheduleDate)) throw new Error('請輸入有效日期。')
      const fields = {
        name: String(data.get('name') ?? ''),
        type,
        amountMinor: parseAmount(String(data.get('amount') ?? '')),
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

      const saved = rule
        ? await onEdit(rule.id, recurringRuleUpdateSchema.parse({ ...fields, revision: rule.revision }))
        : await onCreate(recurringRuleCreateSchema.parse({ id: draftIdRef.current, ...fields }))
      if (saved) onClose()
    } catch (error) {
      setLocalError(validationMessage(error))
    }
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
          <h2 id="recurring-dialog-title">{editing ? '修改週期交易' : '新增週期交易'}</h2>
          <button className="icon-button dialog-close" type="button" onClick={onClose} disabled={saving} aria-label="關閉">
            <X aria-hidden="true" />
          </button>
        </header>

        <form onSubmit={handleSubmit} noValidate>
          <label>
            <span>名稱</span>
            <input
              ref={nameRef}
              name="name"
              maxLength={80}
              defaultValue={rule?.name ?? ''}
              placeholder="例如：每月租金"
              required
            />
          </label>

          <div className="type-switch" role="group" aria-label="交易類型">
            <button
              type="button"
              className={type === 'expense' ? 'is-active expense' : undefined}
              aria-pressed={type === 'expense'}
              onClick={() => selectType('expense')}
            >
              <ArrowDownRight aria-hidden="true" />
              支出
            </button>
            <button
              type="button"
              className={type === 'income' ? 'is-active income' : undefined}
              aria-pressed={type === 'income'}
              onClick={() => selectType('income')}
            >
              <ArrowUpRight aria-hidden="true" />
              收入
            </button>
          </div>

          <label className="amount-field recurring-amount-field">
            <span>每次金額</span>
            <span className="amount-input-wrap">
              <span>HK$</span>
              <input
                name="amount"
                inputMode="decimal"
                autoComplete="off"
                defaultValue={rule ? (rule.amountMinor / 100).toFixed(2) : ''}
                placeholder="0.00"
                pattern="[0-9]+([.][0-9]{1,2})?"
                aria-invalid={Boolean(error)}
                required
              />
            </span>
            {rule ? <small>目前：{formatMoney(rule.amountMinor)}</small> : null}
          </label>

          <div className="form-grid recurring-form-grid">
            <label>
              <span>帳戶</span>
              <select value={accountId} onChange={(event) => setAccountId(Number(event.target.value))} required>
                {accounts.map((account) => (
                  <option value={account.id} key={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>分類</span>
              <select value={categoryId} onChange={(event) => setCategoryId(Number(event.target.value))} required>
                {matchingCategories.map((category) => (
                  <option value={category.id} key={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>頻率</span>
              <select value={frequency} onChange={(event) => setFrequency(event.target.value as RecurrenceFrequency)}>
                {Object.entries(frequencyLabels).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{editing ? '週期基準日期' : '首次產生日期'}</span>
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
              選擇每月 29–31 日時，較短月份會在該月最後一日產生，之後仍回到原本日期。
            </p>
          ) : null}

          {rule ? (
            <p className="schedule-note">
              目前下次產生日期：{formatHongKongDate(rule.nextOccurrenceOn)}。儲存後會按新的基準日期重新計算未來排程。
            </p>
          ) : null}

          <label>
            <span>商戶／對象</span>
            <input name="payee" maxLength={80} defaultValue={rule?.payee ?? ''} placeholder="例如：業主或僱主" />
          </label>
          <label>
            <span>備註（選填）</span>
            <textarea name="note" maxLength={200} rows={2} defaultValue={rule?.note ?? ''} placeholder="加入簡短備註" />
          </label>

          <label className="active-toggle">
            <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
            <span>
              <strong>啟用自動產生</strong>
              <small>關閉後會保留設定，但不會產生新交易。</small>
            </span>
          </label>

          <p className="schedule-note" id="recurring-future-note">
            系統只記錄日期，不設時間欄位。修改只影響尚未產生的交易，歷史交易不會改動。
          </p>

          {error ? (
            <p className="form-error" id="recurring-form-error" role="alert">
              {error}
            </p>
          ) : null}

          {!online ? <p className="offline-form-note">離線時不會提交或儲存週期交易。</p> : null}

          <div className="dialog-actions">
            <button className="button button-primary save-button" type="submit" disabled={saving || !online}>
              {saving ? <LoaderCircle className="spin" aria-hidden="true" /> : null}
              {saving ? '正在儲存…' : editing ? '儲存修改' : '建立週期交易'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
