import { monthRangeDates } from './date'
import { dueOccurrences, firstOccurrenceOnOrAfter } from './recurrence'
import type {
  AccountLocalizationKey,
  RecurrenceFrequency,
  ScheduledRecurringSummary,
  ScheduledRecurringTransferSummary,
  TransactionType,
} from './schema'

export type RecurringForecastRule = {
  id: string
  name: string
  type: TransactionType
  amountMinor: number
  payee: string
  accountId?: number
  categoryId?: number
  frequency: RecurrenceFrequency
  nextOccurrenceOn: string
  anchorDay: number
  /** Missing only when a cached newer app shell reads an older API response. */
  scheduleEndsOn?: string | null
}

export type RecurringTransferForecastRule = {
  id: string
  name: string
  amountMinor: number
  fromAccountId: number
  fromAccountName: string
  fromAccountLocalizationKey: AccountLocalizationKey | null
  toAccountId: number
  toAccountName: string
  toAccountLocalizationKey: AccountLocalizationKey | null
  frequency: RecurrenceFrequency
  nextOccurrenceOn: string
  anchorDay: number
  /** Missing only when a cached newer app shell reads an older API response. */
  scheduleEndsOn?: string | null
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
  accountId?: number
  categoryId?: number
  frequency: RecurrenceFrequency
  occurrenceOn: string
}

export type RecurringTransferForecastOccurrence = {
  recurringTransferRuleId: string
  name: string
  amountMinor: number
  fromAccountId: number
  fromAccountName: string
  fromAccountLocalizationKey: AccountLocalizationKey | null
  toAccountId: number
  toAccountName: string
  toAccountLocalizationKey: AccountLocalizationKey | null
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
    ...(rule.accountId === undefined ? {} : { accountId: rule.accountId }),
    ...(rule.categoryId === undefined ? {} : { categoryId: rule.categoryId }),
    frequency: rule.frequency,
    occurrenceOn,
  }))).sort((left, right) => (
    left.occurrenceOn.localeCompare(right.occurrenceOn)
    || left.recurringRuleId.localeCompare(right.recurringRuleId)
  ))
}

export function recurringTransferForecastOccurrences(
  forecast: readonly ScheduledRecurringTransferSummary[],
): RecurringTransferForecastOccurrence[] {
  return forecast.flatMap((rule) => rule.occurrenceDates.map((occurrenceOn) => ({
    recurringTransferRuleId: rule.recurringTransferRuleId,
    name: rule.name,
    amountMinor: rule.amountMinor,
    fromAccountId: rule.fromAccountId,
    fromAccountName: rule.fromAccountName,
    fromAccountLocalizationKey: rule.fromAccountLocalizationKey,
    toAccountId: rule.toAccountId,
    toAccountName: rule.toAccountName,
    toAccountLocalizationKey: rule.toAccountLocalizationKey,
    frequency: rule.frequency,
    occurrenceOn,
  }))).sort((left, right) => (
    left.occurrenceOn.localeCompare(right.occurrenceOn)
    || left.recurringTransferRuleId.localeCompare(right.recurringTransferRuleId)
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
    const schedule = forecastScheduleForMonth(rule, start, end)
    if (!schedule) return []
    const { firstOccurrenceOn, occurrenceDates } = schedule
    const occurrenceCount = occurrenceDates.length

    return [{
      recurringRuleId: rule.id,
      name: rule.name,
      type: rule.type,
      amountMinor: rule.amountMinor,
      payee: rule.payee,
      ...(rule.accountId === undefined ? {} : { accountId: rule.accountId }),
      ...(rule.categoryId === undefined ? {} : { categoryId: rule.categoryId }),
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

export function recurringTransferForecastForMonth(
  rules: readonly RecurringTransferForecastRule[],
  month: string,
): ScheduledRecurringTransferSummary[] {
  const { start, end } = monthRangeDates(month)

  return rules.flatMap((rule) => {
    const schedule = forecastScheduleForMonth(rule, start, end)
    if (!schedule) return []
    const { firstOccurrenceOn, occurrenceDates } = schedule

    return [{
      recurringTransferRuleId: rule.id,
      name: rule.name,
      amountMinor: rule.amountMinor,
      fromAccountId: rule.fromAccountId,
      fromAccountName: rule.fromAccountName,
      fromAccountLocalizationKey: rule.fromAccountLocalizationKey,
      toAccountId: rule.toAccountId,
      toAccountName: rule.toAccountName,
      toAccountLocalizationKey: rule.toAccountLocalizationKey,
      frequency: rule.frequency,
      firstOccurrenceOn,
      occurrenceCount: occurrenceDates.length,
      occurrenceDates,
    }]
  }).sort((left, right) => (
    left.firstOccurrenceOn.localeCompare(right.firstOccurrenceOn)
    || left.recurringTransferRuleId.localeCompare(right.recurringTransferRuleId)
  ))
}

function forecastScheduleForMonth(
  rule: Pick<
    RecurringForecastRule,
    'nextOccurrenceOn' | 'frequency' | 'anchorDay' | 'scheduleEndsOn'
  >,
  start: string,
  end: string,
) {
  const firstOccurrenceOn = firstOccurrenceOnOrAfter(
    rule.nextOccurrenceOn,
    start,
    rule.frequency,
    rule.anchorDay,
  )
  if (firstOccurrenceOn >= end || (rule.scheduleEndsOn && firstOccurrenceOn > rule.scheduleEndsOn)) {
    return null
  }

  return {
    firstOccurrenceOn,
    occurrenceDates: dueOccurrences(
      firstOccurrenceOn,
      end,
      rule.frequency,
      rule.anchorDay,
      32,
    ).occurrences.filter((date) => date < end && (!rule.scheduleEndsOn || date <= rule.scheduleEndsOn)),
  }
}
