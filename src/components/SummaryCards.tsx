import { ArrowDownRight, ArrowUpRight, Scale } from 'lucide-react'
import { useI18n } from '../i18n'
import type { Summary } from '../lib/schema'

type SummaryCardsProps = {
  summary: Summary
  loading: boolean
}

const placeholder = '—'

export function SummaryCards({ summary, loading }: SummaryCardsProps) {
  const { formatMoney, t } = useI18n()

  return (
    <section className="summary-grid" aria-label={t('monthSummary')} aria-busy={loading}>
      <article className="summary-card summary-balance">
        <div className="summary-label">
          <Scale aria-hidden="true" />
          <span>{t('monthBalance')}</span>
        </div>
        <strong>{loading ? placeholder : formatMoney(summary.balance)}</strong>
      </article>
      <article className="summary-card summary-income">
        <div className="summary-label">
          <ArrowUpRight aria-hidden="true" />
          <span>{t('monthIncome')}</span>
        </div>
        <strong>{loading ? placeholder : formatMoney(summary.income)}</strong>
      </article>
      <article className="summary-card summary-expense">
        <div className="summary-label">
          <ArrowDownRight aria-hidden="true" />
          <span>{t('monthExpense')}</span>
        </div>
        <strong>{loading ? placeholder : formatMoney(summary.expense)}</strong>
      </article>
    </section>
  )
}
