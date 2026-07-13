import { TrendingUp } from 'lucide-react'
import { useMemo } from 'react'
import { useI18n } from '../i18n'
import type { Summary } from '../lib/schema'

type SpendingTrendProps = {
  summary: Summary
  loading: boolean
  onSelectMonth: (month: string) => void
}

export function SpendingTrend({ summary, loading, onSelectMonth }: SpendingTrendProps) {
  const { formatMoney, formatMonth, locale, privacyMode, t } = useI18n()
  const compactMonthFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }),
    [locale],
  )
  const maxExpense = Math.max(...summary.spendingTrend.map(({ amountMinor }) => amountMinor), 0)
  const hasSpending = maxExpense > 0

  return (
    <section
      className="category-spending-panel spending-trend-panel"
      aria-labelledby="spending-trend-title"
      aria-busy={loading}
    >
      <header className="category-spending-heading">
        <span className="category-spending-heading-icon spending-trend-heading-icon" aria-hidden="true">
          <TrendingUp />
        </span>
        <div>
          <h2 id="spending-trend-title">{t('spendingTrend')}</h2>
          <p>{t('spendingTrendHelp')}</p>
        </div>
      </header>

      {loading ? (
        <p className="category-spending-empty" role="status">{t('spendingTrendLoading')}</p>
      ) : !hasSpending ? (
        <div className="category-spending-empty">
          <strong>{t('noSpendingTrend')}</strong>
          <span>{t('noSpendingTrendHelp')}</span>
        </div>
      ) : (
        <ol className="spending-trend-chart">
          {summary.spendingTrend.map((point) => {
            const selected = point.month === summary.month
            const fullMonth = formatMonth(point.month)
            const amount = formatMoney(point.amountMinor)
            const transactions = t('transactionCount', { count: point.transactionCount })
            const height = point.amountMinor > 0 && maxExpense > 0
              ? Math.max((point.amountMinor / maxExpense) * 100, 6)
              : 0
            const compactMonth = compactMonthFormatter.format(
              new Date(`${point.month}-15T00:00:00.000Z`),
            )

            return (
              <li key={point.month}>
                <button
                  className={selected ? 'is-selected' : undefined}
                  type="button"
                  aria-current={selected ? 'date' : undefined}
                  aria-label={t('reviewMonthlySpending', {
                    month: fullMonth,
                    amount,
                    transactions,
                  })}
                  title={t('reviewMonthlySpending', {
                    month: fullMonth,
                    amount,
                    transactions,
                  })}
                  onClick={() => onSelectMonth(point.month)}
                >
                  <span className="spending-trend-plot" aria-hidden="true">
                    <span
                      className="spending-trend-bar"
                      style={{ height: `${privacyMode ? 28 : height}%` }}
                    />
                  </span>
                  <time dateTime={point.month}>{compactMonth}</time>
                </button>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
