import { useI18n } from '../i18n'
import type { TransactionFilterSummary as FilterSummary } from '../lib/schema'

type TransactionFilterSummaryProps = {
  summary: FilterSummary
  loading: boolean
}

const placeholder = '—'

export function TransactionFilterSummary({ summary, loading }: TransactionFilterSummaryProps) {
  const { formatMoney, formatNumber, t } = useI18n()
  const items = [
    { label: t('filteredTransactionCount'), value: formatNumber(summary.transactionCount) },
    { label: t('filteredIncome'), value: formatMoney(summary.income) },
    { label: t('filteredExpense'), value: formatMoney(summary.expense) },
    { label: t('filteredNet'), value: formatMoney(summary.net) },
  ]

  return (
    <section
      className="transaction-filter-summary"
      aria-label={t('filteredResultsSummary')}
      aria-busy={loading}
    >
      {items.map((item) => (
        <div className="transaction-filter-summary-item" key={item.label}>
          <span>{item.label}</span>
          <strong>{loading ? placeholder : item.value}</strong>
        </div>
      ))}
    </section>
  )
}
