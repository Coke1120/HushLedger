import { GitCompareArrows } from 'lucide-react'
import { useI18n } from '../i18n'
import type { SupportedCurrency } from '../lib/currency'
import type { RecurringAmountReview as RecurringAmountReviewValue } from '../lib/recurringAmountReview'

type RecurringAmountReviewProps = {
  currency: SupportedCurrency
  review: RecurringAmountReviewValue
}

export function RecurringAmountReview({
  currency,
  review,
}: RecurringAmountReviewProps) {
  const { formatDate, formatMoney, t } = useI18n()

  return (
    <div className="recurring-amount-review">
      <GitCompareArrows aria-hidden="true" />
      <div>
        <strong>{t('recurringAmountReviewTitle')}</strong>
        <p>{t('recurringAmountReviewDetails', {
          date: formatDate(review.latestGeneratedDueOn),
          recorded: formatMoney(review.latestGeneratedAmountMinor, currency),
          future: formatMoney(review.futureAmountMinor, currency),
        })}</p>
        <small>{t('recurringAmountReviewHelp')}</small>
      </div>
    </div>
  )
}
