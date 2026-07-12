import { CalendarClock, Repeat2 } from 'lucide-react'
import { useI18n } from '../i18n'
import type { Summary } from '../lib/schema'

type RecurringForecastProps = {
  summary: Summary
  loading: boolean
  onManage: () => void
}

const visibleRuleLimit = 5

export function RecurringForecast({ summary, loading, onManage }: RecurringForecastProps) {
  const { formatDate, formatMoney, t } = useI18n()
  const visibleRules = summary.recurringForecast.slice(0, visibleRuleLimit)
  const remainingRules = summary.recurringForecast.length - visibleRules.length

  return (
    <section
      className="category-spending-panel recurring-forecast-panel"
      aria-labelledby="recurring-forecast-title"
      aria-busy={loading}
    >
      <header className="category-spending-heading">
        <span className="category-spending-heading-icon recurring-forecast-heading-icon" aria-hidden="true">
          <CalendarClock />
        </span>
        <div>
          <h2 id="recurring-forecast-title">{t('scheduledThisMonth')}</h2>
          <p>{t('scheduledThisMonthHelp')}</p>
        </div>
      </header>

      {loading ? (
        <p className="category-spending-empty" role="status">{t('scheduledForecastLoading')}</p>
      ) : visibleRules.length === 0 ? (
        <div className="category-spending-empty">
          <strong>{t('noScheduledThisMonth')}</strong>
          <span>{t('noScheduledThisMonthHelp')}</span>
        </div>
      ) : (
        <>
          <ol className="category-spending-list">
            {visibleRules.map((rule) => {
              const date = formatDate(rule.firstOccurrenceOn)
              const amount = formatMoney(rule.amountMinor)
              const occurrences = t('scheduledOccurrenceCount', { count: rule.occurrenceCount })

              return (
                <li key={rule.recurringRuleId}>
                  <button
                    className="category-spending-row recurring-forecast-row"
                    type="button"
                    onClick={onManage}
                    aria-label={t('manageScheduledRule', {
                      name: rule.name,
                      date,
                      amount,
                      occurrences,
                    })}
                  >
                    <span className="category-spending-name">
                      <span
                        className={`recurring-forecast-rule-icon ${rule.type}`}
                        aria-hidden="true"
                      >
                        <Repeat2 />
                      </span>
                      <span>
                        <strong>{rule.name}</strong>
                        <small>{date} · {t(rule.frequency)}</small>
                      </span>
                    </span>
                    <span className="category-spending-amount">
                      <strong className={rule.type}>
                        {rule.type === 'income' ? '+' : '−'}{amount}
                      </strong>
                      <small>{occurrences} · {t('eachTime')}</small>
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
          {remainingRules > 0 ? (
            <p className="category-spending-more">
              {t('moreScheduledRules', { count: remainingRules })}
            </p>
          ) : null}
        </>
      )}
    </section>
  )
}
