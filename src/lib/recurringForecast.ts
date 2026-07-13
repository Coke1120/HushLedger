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

export type RecurringForecastTotals = {
  incomeMinor: number
  expenseMinor: number
  netMinor: number
}

export function summarizeRecurringForecast(
  forecast: readonly ScheduledRecurringSummary[],
): RecurringForecastTotals | null {
  let incomeMinor = 0n
  let expenseMinor = 0n

  for (const rule of forecast) {
    const total = BigInt(rule.amountMinor) * BigInt(rule.occurrenceCount)
    if (rule.type === 'income') incomeMinor += total
    else expenseMinor += total
  }

  const safeIntegerLimit = BigInt(Number.MAX_SAFE_INTEGER)
  if (incomeMinor > safeIntegerLimit || expenseMinor > safeIntegerLimit) return null

  return {
    incomeMinor: Number(incomeMinor),
    expenseMinor: Number(expenseMinor),
    netMinor: Number(incomeMinor - expenseMinor),
  }
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
