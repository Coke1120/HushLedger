import { Target } from 'lucide-react'
import { useMemo } from 'react'
import { useI18n } from '../i18n'
import type { Summary } from '../lib/schema'

type MonthlySpendingPlansProps = {
  summary: Summary
  loading: boolean
  onSelect: (categoryId: number) => void
}

const visiblePlanLimit = 5

export function MonthlySpendingPlans({
  summary,
  loading,
  onSelect,
}: MonthlySpendingPlansProps) {
  const { formatMoney, locale, localizeEntityName, privacyMode, t } = useI18n()
  const percentFormatter = useMemo(
    () => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }),
    [locale],
  )
  const visiblePlans = summary.monthlySpendingPlans.slice(0, visiblePlanLimit)
  const remainingPlans = summary.monthlySpendingPlans.length - visiblePlans.length

  return (
    <section
      className="category-spending-panel monthly-plans-panel"
      aria-labelledby="monthly-plans-title"
      aria-busy={loading}
    >
      <header className="category-spending-heading">
        <span className="category-spending-heading-icon monthly-plans-heading-icon" aria-hidden="true">
          <Target />
        </span>
        <div>
          <h2 id="monthly-plans-title">{t('monthlyPlansTitle')}</h2>
          <p>{t('monthlyPlansHelp')}</p>
        </div>
      </header>

      {loading ? (
        <p className="category-spending-empty" role="status">{t('monthlyPlansLoading')}</p>
      ) : visiblePlans.length === 0 ? (
        <div className="category-spending-empty">
          <strong>{t('noMonthlyPlans')}</strong>
          <span>{t('noMonthlyPlansHelp')}</span>
        </div>
      ) : (
        <>
          <ol className="category-spending-list">
            {visiblePlans.map((plan) => {
              const name = localizeEntityName(plan.categoryName, plan.categoryLocalizationKey)
              const ratio = plan.spentMinor / plan.plannedMinor
              const remainingMinor = plan.plannedMinor - plan.spentMinor
              const planned = formatMoney(plan.plannedMinor)
              const spent = formatMoney(plan.spentMinor)
              const status = remainingMinor >= 0
                ? t('monthlyPlanRemaining', { amount: formatMoney(remainingMinor) })
                : t('monthlyPlanOverBy', { amount: formatMoney(Math.abs(remainingMinor)) })
              const visibleStatus = privacyMode ? t('sensitiveTextHidden') : status
              const percent = privacyMode ? '—' : percentFormatter.format(ratio)

              return (
                <li key={plan.categoryId}>
                  <button
                    className="category-spending-row monthly-plan-row"
                    type="button"
                    onClick={() => onSelect(plan.categoryId)}
                    aria-label={t('reviewMonthlyPlan', {
                      name,
                      spent,
                      planned,
                      status: visibleStatus,
                    })}
                  >
                    <span className="category-spending-name">
                      <span
                        className="category-spending-dot"
                        style={{ backgroundColor: plan.categoryColor }}
                        aria-hidden="true"
                      />
                      <span>
                        <strong>{name}</strong>
                        <small>{t('monthlyPlanPlanned', { amount: planned })}</small>
                      </span>
                    </span>
                    <span className="category-spending-amount">
                      <strong className={remainingMinor < 0 ? 'expense' : undefined}>{spent}</strong>
                      <small>{visibleStatus} · {percent}</small>
                    </span>
                    <span className="category-spending-track" aria-hidden="true">
                      <span
                        className={remainingMinor < 0 ? 'is-over' : undefined}
                        style={{
                          width: privacyMode ? '0%' : `${Math.min(ratio * 100, 100)}%`,
                          backgroundColor: remainingMinor < 0 ? undefined : plan.categoryColor,
                        }}
                      />
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
          {remainingPlans > 0 ? (
            <p className="category-spending-more">
              {t('moreMonthlyPlans', { count: remainingPlans })}
            </p>
          ) : null}
        </>
      )}
    </section>
  )
}
