import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { useI18n } from '../i18n'

type MonthNavigatorProps = {
  month: string
  currentMonth: string
  disabled: boolean
  onChange: (month: string) => void
  onPrevious: () => void
  onNext: () => void
}

export function MonthNavigator({
  month,
  currentMonth,
  disabled,
  onChange,
  onPrevious,
  onNext,
}: MonthNavigatorProps) {
  const { formatMonth, t } = useI18n()

  return (
    <section className="month-navigator" aria-label={t('chooseReportMonth')}>
      <button className="icon-button" type="button" onClick={onPrevious} disabled={disabled} aria-label={t('previousMonth')}>
        <ChevronLeft aria-hidden="true" />
      </button>
      <label className="month-picker">
        <CalendarDays aria-hidden="true" />
        <span>{formatMonth(month)}</span>
        <input
          type="month"
          value={month}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          aria-label={t('viewMonth')}
        />
      </label>
      <button className="icon-button" type="button" onClick={onNext} disabled={disabled} aria-label={t('nextMonth')}>
        <ChevronRight aria-hidden="true" />
      </button>
      <button
        className="button button-secondary current-month-button"
        type="button"
        onClick={() => onChange(currentMonth)}
        disabled={disabled || month === currentMonth}
      >
        <CalendarDays aria-hidden="true" />
        {t('returnCurrentMonth')}
      </button>
    </section>
  )
}
