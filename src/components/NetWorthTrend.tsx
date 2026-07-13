import { TrendingUp } from 'lucide-react'
import { useMemo } from 'react'
import { useI18n } from '../i18n'
import type { NetWorthTrendPoint } from '../lib/schema'

type NetWorthTrendProps = {
  points: NetWorthTrendPoint[]
  month: string
  loading: boolean
  onSelectMonth: (month: string) => void
}

export function NetWorthTrend({ points, month, loading, onSelectMonth }: NetWorthTrendProps) {
  const { formatMoney, formatMonth, locale, privacyMode, t } = useI18n()
  const compactMonthFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }),
    [locale],
  )
  const availablePoints = points.filter(
    (point): point is NetWorthTrendPoint & { netWorthMinor: number } => (
      point.netWorthMinor !== null
    ),
  )
  const current = availablePoints.find((point) => point.month === month)
  const first = availablePoints[0]
  const change = current && first && current.month !== first.month
    ? current.netWorthMinor - first.netWorthMinor
    : null
  const maxAbsolute = Math.max(
    ...availablePoints.map(({ netWorthMinor }) => Math.abs(netWorthMinor)),
    0,
  )
  const hasAccounts = points.some(({ accountCount }) => accountCount > 0)

  return (
    <section
      className="category-spending-panel net-worth-panel"
      aria-labelledby="net-worth-title"
      aria-busy={loading}
    >
      <header className="category-spending-heading net-worth-heading">
        <span className="category-spending-heading-icon net-worth-heading-icon" aria-hidden="true">
          <TrendingUp />
        </span>
        <div>
          <h2 id="net-worth-title">{t('netWorthTrendTitle')}</h2>
          <p>{t('netWorthTrendHelp')}</p>
        </div>
      </header>

      {loading ? (
        <p className="category-spending-empty" role="status">{t('netWorthTrendLoading')}</p>
      ) : !hasAccounts ? (
        <div className="category-spending-empty">
          <strong>{t('noNetWorthTrend')}</strong>
          <span>{t('noNetWorthTrendHelp')}</span>
        </div>
      ) : (
        <>
          <dl className="net-worth-summary">
            <div>
              <dt>{t('recordedNetWorth')}</dt>
              <dd>{current ? formatMoney(current.netWorthMinor) : t('netWorthUnavailableShort')}</dd>
            </div>
            <div>
              <dt>{first && change !== null
                ? t('netWorthChangeSince', { month: formatMonth(first.month) })
                : t('netWorthSixMonthChange')}</dt>
              <dd className={privacyMode || change === null ? undefined : change >= 0 ? 'is-positive' : 'is-negative'}>
                {change === null ? t('netWorthUnavailableShort') : formatMoney(change)}
              </dd>
            </div>
          </dl>
          <ol className="net-worth-trend-list">
            {points.map((point) => {
              const selected = point.month === month
              const fullMonth = formatMonth(point.month)
              const compactMonth = compactMonthFormatter.format(
                new Date(`${point.month}-15T00:00:00.000Z`),
              )
              const available = point.netWorthMinor !== null
              const amount = available ? formatMoney(point.netWorthMinor ?? 0) : null
              const width = available && maxAbsolute > 0
                ? Math.max((Math.abs(point.netWorthMinor ?? 0) / maxAbsolute) * 50, 2)
                : 0
              const barStyle = privacyMode
                ? { left: '41%', width: '18%' }
                : point.netWorthMinor !== null && point.netWorthMinor < 0
                  ? { right: '50%', width: `${width}%` }
                  : { left: '50%', width: `${width}%` }
              const label = available
                ? t('reviewMonthlyNetWorth', { month: fullMonth, amount: amount ?? '' })
                : t('reviewUnavailableNetWorth', {
                    month: fullMonth,
                    count: point.unavailableAccountCount,
                  })

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
                    <time dateTime={point.month}>{compactMonth}</time>
                    <span className="net-worth-bar-track" aria-hidden="true">
                      {available ? (
                        <span
                          className={`net-worth-bar ${privacyMode ? 'is-private' : (point.netWorthMinor ?? 0) < 0 ? 'is-negative' : 'is-positive'}`}
                          style={barStyle}
                        />
                      ) : null}
                    </span>
                    <strong>{amount ?? t('netWorthUnavailableShort')}</strong>
                  </button>
                </li>
              )
            })}
          </ol>
          {points.some(({ unavailableAccountCount }) => unavailableAccountCount > 0) ? (
            <p className="net-worth-history-note">{t('netWorthHistoryIncomplete')}</p>
          ) : null}
        </>
      )}
    </section>
  )
}
