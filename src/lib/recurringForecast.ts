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
  payee: string
  frequency: RecurrenceFrequency
  nextOccurrenceOn: string
  anchorDay: number
}

export type RecurringForecastTotals = {
  incomeMinor: number
  expenseMinor: number
  netMinor: number
}

export type RecurringForecastPeriod = {
  index: 1 | 2 | 3 | 4 | 5
  startOn: string
  endOnExclusive: string
  totals: RecurringForecastTotals | null
}

export type RecurringForecastOccurrence = {
  recurringRuleId: string
  name: string
  type: TransactionType
  amountMinor: number
  payee: string
  frequency: RecurrenceFrequency
  occurrenceOn: string
}

const safeIntegerLimit = BigInt(Number.MAX_SAFE_INTEGER)

function safeRecurringForecastTotals(
  incomeMinor: bigint,
  expenseMinor: bigint,
): RecurringForecastTotals | null {
  if (incomeMinor > safeIntegerLimit || expenseMinor > safeIntegerLimit) return null

  return {
    incomeMinor: Number(incomeMinor),
    expenseMinor: Number(expenseMinor),
    netMinor: Number(incomeMinor - expenseMinor),
  }
}

function addCalendarDays(date: string, days: number) {
  const shifted = new Date(`${date}T00:00:00.000Z`)
  shifted.setUTCDate(shifted.getUTCDate() + days)
  return shifted.toISOString().slice(0, 10)
}

export function recurringForecastOccurrences(
  forecast: readonly ScheduledRecurringSummary[],
): RecurringForecastOccurrence[] {
  return forecast.flatMap((rule) => rule.occurrenceDates.map((occurrenceOn) => ({
    recurringRuleId: rule.recurringRuleId,
    name: rule.name,
    type: rule.type,
    amountMinor: rule.amountMinor,
    payee: rule.payee,
    frequency: rule.frequency,
    occurrenceOn,
  }))).sort((left, right) => (
    left.occurrenceOn.localeCompare(right.occurrenceOn)
    || left.recurringRuleId.localeCompare(right.recurringRuleId)
  ))
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

  return safeRecurringForecastTotals(incomeMinor, expenseMinor)
}

export function recurringForecastPeriods(
  month: string,
  forecast: readonly ScheduledRecurringSummary[],
): RecurringForecastPeriod[] {
  const { start, end } = monthRangeDates(month)
  const boundaries = [0, 7, 14, 21, 28, 35].map((days) => {
    const boundary = addCalendarDays(start, days)
    return boundary < end ? boundary : end
  })
  const totals = Array.from({ length: 5 }, () => ({ incomeMinor: 0n, expenseMinor: 0n }))

  for (const rule of forecast) {
    if (!Number.isSafeInteger(rule.amountMinor) || rule.amountMinor < 0) {
      throw new Error('Recurring forecast amount must be a non-negative safe integer')
    }

    for (const occurrenceOn of rule.occurrenceDates) {
      if (occurrenceOn < start || occurrenceOn >= end) {
        throw new Error('Recurring forecast occurrence is outside the selected month')
      }

      const periodIndex = boundaries.findIndex((boundary, index) => (
        index < 5 && occurrenceOn >= boundary && occurrenceOn < boundaries[index + 1]
      ))
      if (periodIndex < 0) {
        throw new Error('Recurring forecast occurrence is outside the selected periods')
      }

      totals[periodIndex][rule.type === 'income' ? 'incomeMinor' : 'expenseMinor']
        += BigInt(rule.amountMinor)
    }
  }

  return totals.map((total, index) => ({
    index: (index + 1) as RecurringForecastPeriod['index'],
    startOn: boundaries[index],
    endOnExclusive: boundaries[index + 1],
    totals: safeRecurringForecastTotals(total.incomeMinor, total.expenseMinor),
  }))
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

    const occurrenceDates = dueOccurrences(
      firstOccurrenceOn,
      end,
      rule.frequency,
      rule.anchorDay,
      32,
    ).occurrences.filter((date) => date < end)
    const occurrenceCount = occurrenceDates.length

    return [{
      recurringRuleId: rule.id,
      name: rule.name,
      type: rule.type,
      amountMinor: rule.amountMinor,
      payee: rule.payee,
      frequency: rule.frequency,
      firstOccurrenceOn,
      occurrenceCount,
      occurrenceDates,
    }]
  }).sort((left, right) => (
    left.firstOccurrenceOn.localeCompare(right.firstOccurrenceOn)
    || left.recurringRuleId.localeCompare(right.recurringRuleId)
  ))
}
