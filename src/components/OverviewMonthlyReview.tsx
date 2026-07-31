import type { KeyboardEvent, ReactNode } from 'react'
import { useI18n, type MessageKey } from '../i18n'

export type OverviewReview = 'netWorth' | 'cashFlow' | 'income' | 'spending' | 'plans' | 'outlook'

const reviewOptions: ReadonlyArray<{
  value: OverviewReview
  labelKey: MessageKey
}> = [
  { value: 'netWorth', labelKey: 'netWorthTrendTitle' },
  { value: 'cashFlow', labelKey: 'cashFlowTrend' },
  { value: 'income', labelKey: 'incomeSourcesTitle' },
  { value: 'spending', labelKey: 'spendingBreakdown' },
  { value: 'plans', labelKey: 'monthlyPlansTitle' },
  { value: 'outlook', labelKey: 'scheduledOutlookTitle' },
]

type OverviewMonthlyReviewProps = {
  selected: OverviewReview
  content: Readonly<Record<OverviewReview, ReactNode>>
  onChange: (value: OverviewReview) => void
}

export function OverviewMonthlyReview({
  selected,
  content,
  onChange,
}: OverviewMonthlyReviewProps) {
  const { t } = useI18n()

  const selectFromKeyboard = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) => {
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % reviewOptions.length
    if (event.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + reviewOptions.length) % reviewOptions.length
    }
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = reviewOptions.length - 1
    if (nextIndex === null) return

    event.preventDefault()
    const next = reviewOptions[nextIndex]
    onChange(next.value)
    const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    tabs?.[nextIndex]?.focus()
  }

  return (
    <section className="overview-monthly-review" aria-labelledby="overview-monthly-review-title">
      <div className="overview-monthly-review-heading">
        <div>
          <h2 id="overview-monthly-review-title">{t('monthlyReviewTitle')}</h2>
          <p>{t('monthlyReviewHelp')}</p>
        </div>
      </div>
      <div
        className="overview-review-tabs"
        role="tablist"
        aria-label={t('monthlyReviewTitle')}
      >
        {reviewOptions.map((option, index) => {
          const active = selected === option.value
          return (
            <button
              id={`overview-review-tab-${option.value}`}
              key={option.value}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls="overview-review-panel"
              tabIndex={active ? 0 : -1}
              className={active ? 'is-active' : undefined}
              onClick={() => onChange(option.value)}
              onKeyDown={(event) => selectFromKeyboard(event, index)}
            >
              {t(option.labelKey)}
            </button>
          )
        })}
      </div>
      <div
        id="overview-review-panel"
        className="overview-review-panel"
        role="tabpanel"
        aria-labelledby={`overview-review-tab-${selected}`}
        tabIndex={0}
      >
        {content[selected]}
      </div>
    </section>
  )
}
