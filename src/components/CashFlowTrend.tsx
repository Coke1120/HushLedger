import { TrendingUp } from 'lucide-react'
import { useMemo } from 'react'
import { useI18n } from '../i18n'
import { compareSelectedMonthCashFlow } from '../lib/cashFlowTrend'
import type { Summary } from '../lib/schema'

type CashFlowTrendProps = {
  summary: Summary
  currentMonth: string
  loading: boolean
  onSelectMonth: (month: string) => void
}

export function CashFlowTrend({
  summary,
  currentMonth,
  loading,
  onSelectMonth,
}: CashFlowTrendProps) {
  const { formatMoney, formatMonth, locale, privacyMode, t } = useI18n()
  const compactMonthFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }),
    [locale],
  )
  const availableAmounts = summary.cashFlowTrend.flatMap(({ incomeMinor, expenseMinor }) => [
    ...(incomeMinor === null ? [] : [incomeMinor]),
    ...(expenseMinor === null ? [] : [expenseMinor]),
  ])
  const maxAmount = Math.max(...availableAmounts, 0)
  const hasCashFlow = summary.cashFlowTrend.some(({ transactionCount }) => transactionCount > 0)
  const hasUnavailableAmount = summary.cashFlowTrend.some(
    ({ incomeMinor, expenseMinor, netMinor }) => (
      incomeMinor === null || expenseMinor === null || netMinor === null
    ),
  )
  const comparison = summary.month <= currentMonth
    ? compareSelectedMonthCashFlow(summary.month, summary.cashFlowTrend)
    : null

  const formatDifference = (differenceMinor: number | null) => {
    if (privacyMode) return formatMoney(0)
    if (differenceMinor === null) return t('cashFlowUnavailableShort')
    const amount = formatMoney(differenceMinor)
    return differenceMinor > 0 ? `+${amount}` : amount
  }

  const barHeight = (amountMinor: number | null) => {
    if (privacyMode) return 28
    if (amountMinor === null) return 8
    if (amountMinor <= 0 || maxAmount <= 0) return 0
    return Math.max((amountMinor / maxAmount) * 100, 6)
  }

  return (
    <section
      className="category-spending-panel cash-flow-trend-panel"
      aria-labelledby="cash-flow-trend-title"
      aria-busy={loading}
    >
      <header className="category-spending-heading">
        <span className="category-spending-heading-icon cash-flow-trend-heading-icon" aria-hidden="true">
          <TrendingUp />
        </span>
        <div>
          <h2 id="cash-flow-trend-title">{t('cashFlowTrend')}</h2>
          <p>{t('cashFlowTrendHelp')}</p>
        </div>
      </header>

      {loading ? (
        <p className="category-spending-empty" role="status">{t('cashFlowTrendLoading')}</p>
      ) : !privacyMode && !hasCashFlow ? (
        <div className="category-spending-empty">
          <strong>{t('noCashFlowTrend')}</strong>
          <span>{t('noCashFlowTrendHelp')}</span>
        </div>
      ) : (
        <>
          {comparison ? (
            <section
              className="cash-flow-comparison"
              aria-labelledby="cash-flow-comparison-title"
            >
              <header>
                <h3 id="cash-flow-comparison-title">
                  {t('cashFlowComparisonTitle', {
                    month: formatMonth(comparison.previousMonth),
                  })}
                </h3>
                <p>{t(privacyMode
                  ? 'cashFlowComparisonHidden'
                  : 'cashFlowComparisonHelp')}</p>
              </header>
              <dl>
                {([
                  ['income', comparison.incomeDifferenceMinor],
                  ['expense', comparison.expenseDifferenceMinor],
                  ['cashFlowComparisonNet', comparison.netDifferenceMinor],
                ] as const).map(([label, differenceMinor]) => {
                  const value = formatDifference(differenceMinor)
                  return (
                    <div key={label}>
                      <dt>{t(label)}</dt>
                      <dd>{value}</dd>
                    </div>
                  )
                })}
              </dl>
            </section>
          ) : null}
          <ul className="cash-flow-trend-legend" aria-label={t('cashFlowTrendLegend')}>
            <li>
              <span className="cash-flow-trend-swatch is-income" aria-hidden="true" />
              {t('income')}
            </li>
            <li>
              <span className="cash-flow-trend-swatch is-expense" aria-hidden="true" />
              {t('expense')}
            </li>
            {!privacyMode && hasUnavailableAmount ? (
              <li>
                <span className="cash-flow-trend-swatch is-unavailable" aria-hidden="true" />
                {t('cashFlowUnavailableShort')}
              </li>
            ) : null}
          </ul>
          <ol className="cash-flow-trend-chart">
            {summary.cashFlowTrend.map((point) => {
              const selected = point.month === summary.month
              const fullMonth = formatMonth(point.month)
              const transactions = t('transactionCount', { count: point.transactionCount })
              const compactMonth = compactMonthFormatter.format(
                new Date(`${point.month}-15T00:00:00.000Z`),
              )
              let label: string
              if (privacyMode) {
                label = t('reviewMonthlyCashFlowHidden', { month: fullMonth })
              } else if (
                point.incomeMinor === null
                || point.expenseMinor === null
                || point.netMinor === null
              ) {
                label = t('reviewMonthlyCashFlowUnavailable', {
                  month: fullMonth,
                  transactions,
                })
              } else {
                label = t('reviewMonthlyCashFlow', {
                  month: fullMonth,
                  income: formatMoney(point.incomeMinor),
                  expense: formatMoney(point.expenseMinor),
                  net: formatMoney(point.netMinor),
                  transactions,
                })
              }

              return (
                <li key={point.month}>
                  <button
                    className={selected ? 'is-selected' : undefined}
                    type="button"
                    aria-current={selected ? 'date' : undefined}
                    aria-label={label}
                    title={label}
                    onClick={() => onSelectMonth(point.month)}
                  >
                    <span className="cash-flow-trend-plot" aria-hidden="true">
                      <span
                        className={`cash-flow-trend-bar is-income${privacyMode ? ' is-private' : point.incomeMinor === null ? ' is-unavailable' : ''}`}
                        style={{ height: `${barHeight(point.incomeMinor)}%` }}
                      />
                      <span
                        className={`cash-flow-trend-bar is-expense${privacyMode ? ' is-private' : point.expenseMinor === null ? ' is-unavailable' : ''}`}
                        style={{ height: `${barHeight(point.expenseMinor)}%` }}
                      />
                    </span>
                    <time dateTime={point.month}>{compactMonth}</time>
                  </button>
                </li>
              )
            })}
          </ol>
        </>
      )}
    </section>
  )
}
