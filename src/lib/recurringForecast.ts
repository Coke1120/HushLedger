import { monthRangeDates } from './date'
import { dueOccurrences, firstOccurrenceOnOrAfter } from './recurrence'
import type {
  RecurrenceFrequency,
  ScheduledRecurringSummary,
  TransactionType,
} from './schema'

export type RecurringForecastRule = {
  id: string
  name: string
  type: TransactionType
  amountMinor: number
  frequency: RecurrenceFrequency
  nextOccurrenceOn: string
  anchorDay: number
}

export function recurringForecastForMonth(
  rules: readonly RecurringForecastRule[],
  month: string,
): ScheduledRecurringSummary[] {
  const { start, end } = monthRangeDates(month)

  return rules.flatMap((rule) => {
    const firstOccurrenceOn = firstOccurrenceOnOrAfter(
      rule.nextOccurrenceOn,
      start,
      rule.frequency,
      rule.anchorDay,
    )
    if (firstOccurrenceOn >= end) return []

    const occurrenceCount = dueOccurrences(
      firstOccurrenceOn,
      end,
      rule.frequency,
      rule.anchorDay,
      32,
    ).occurrences.filter((date) => date < end).length

    return [{
      recurringRuleId: rule.id,
      name: rule.name,
      type: rule.type,
      amountMinor: rule.amountMinor,
      frequency: rule.frequency,
      firstOccurrenceOn,
      occurrenceCount,
    }]
  }).sort((left, right) => (
    left.firstOccurrenceOn.localeCompare(right.firstOccurrenceOn)
    || left.recurringRuleId.localeCompare(right.recurringRuleId)
  ))
}
