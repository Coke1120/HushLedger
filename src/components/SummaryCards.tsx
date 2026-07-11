import { ArrowDownRight, ArrowUpRight, Scale } from 'lucide-react'
import { formatMoney } from '../lib/money'
import type { Summary } from '../lib/schema'

type SummaryCardsProps = {
  summary: Summary
  loading: boolean
}

const placeholder = 'HK$—'

export function SummaryCards({ summary, loading }: SummaryCardsProps) {
  return (
    <section className="summary-grid" aria-label="月份收支摘要" aria-busy={loading}>
      <article className="summary-card summary-balance">
        <div className="summary-label">
          <Scale aria-hidden="true" />
          <span>本月結餘</span>
        </div>
        <strong>{loading ? placeholder : formatMoney(summary.balance)}</strong>
      </article>
      <article className="summary-card summary-income">
        <div className="summary-label">
          <ArrowUpRight aria-hidden="true" />
          <span>本月收入</span>
        </div>
        <strong>{loading ? placeholder : formatMoney(summary.income)}</strong>
      </article>
      <article className="summary-card summary-expense">
        <div className="summary-label">
          <ArrowDownRight aria-hidden="true" />
          <span>本月支出</span>
        </div>
        <strong>{loading ? placeholder : formatMoney(summary.expense)}</strong>
      </article>
    </section>
  )
}
