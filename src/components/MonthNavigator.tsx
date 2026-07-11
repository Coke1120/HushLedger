import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { formatMonthLabel } from '../lib/date'

type MonthNavigatorProps = {
  month: string
  currentMonth: string
  onChange: (month: string) => void
  onPrevious: () => void
  onNext: () => void
}

export function MonthNavigator({ month, currentMonth, onChange, onPrevious, onNext }: MonthNavigatorProps) {
  return (
    <section className="month-navigator" aria-label="選擇報表月份">
      <button className="icon-button" type="button" onClick={onPrevious} aria-label="上一個月">
        <ChevronLeft aria-hidden="true" />
      </button>
      <label className="month-picker">
        <CalendarDays aria-hidden="true" />
        <span>{formatMonthLabel(month)}</span>
        <input type="month" value={month} onChange={(event) => onChange(event.target.value)} aria-label="檢視月份" />
      </label>
      <button className="icon-button" type="button" onClick={onNext} aria-label="下一個月">
        <ChevronRight aria-hidden="true" />
      </button>
      <button
        className="button button-secondary current-month-button"
        type="button"
        onClick={() => onChange(currentMonth)}
        disabled={month === currentMonth}
      >
        <CalendarDays aria-hidden="true" />
        回到本月
      </button>
    </section>
  )
}
