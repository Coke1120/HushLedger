import { ArrowDownRight, ArrowUpRight, Scale } from 'lucide-react'
import { useI18n } from '../i18n'
import type { Summary } from '../lib/schema'

type SummaryCardsProps = {
  summary: Summary
  loading: boolean
  disabled: boolean
  onSelect: (filter: 'all' | 'income' | 'expense') => void
}

const placeholder = '—'

export function SummaryCards({ summary, loading, disabled, onSelect }: SummaryCardsProps) {
  const { formatMoney, t } = useI18n()
  const balance = loading ? placeholder : formatMoney(summary.balance)
  const income = loading ? placeholder : formatMoney(summary.income)
  const expense = loading ? placeholder : formatMoney(summary.expense)
  const actionsDisabled = loading || disabled

  return (
    <section className="summary-grid" aria-label={t('monthSummary')} aria-busy={loading}>
      <button
        className="summary-card summary-balance"
        type="button"
        disabled={actionsDisabled}
        aria-label={loading
          ? t('monthBalance')
          : t('reviewMonthlyBalanceTransactions', { amount: balance })}
        onClick={() => onSelect('all')}
      >
        <div className="summary-label">
          <Scale aria-hidden="true" />
          <span>{t('monthBalance')}</span>
        </div>
        <strong>{balance}</strong>
      </button>
      <button
        className="summary-card summary-income"
        type="button"
        disabled={actionsDisabled}
        aria-label={loading
          ? t('monthIncome')
          : t('reviewMonthlyIncomeTransactions', { amount: income })}
        onClick={() => onSelect('income')}
      >
        <div className="summary-label">
          <ArrowUpRight aria-hidden="true" />
          <span>{t('monthIncome')}</span>
        </div>
        <strong>{income}</strong>
      </button>
      <button
        className="summary-card summary-expense"
        type="button"
        disabled={actionsDisabled}
        aria-label={loading
          ? t('monthExpense')
          : t('reviewMonthlyExpenseTransactions', { amount: expense })}
        onClick={() => onSelect('expense')}
      >
        <div className="summary-label">
          <ArrowDownRight aria-hidden="true" />
          <span>{t('monthExpense')}</span>
        </div>
        <strong>{expense}</strong>
      </button>
    </section>
  )
}
