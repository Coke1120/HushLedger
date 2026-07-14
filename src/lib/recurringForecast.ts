import { isValidCalendarDate, monthRangeDates } from './date'
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

function calendarDaySpan(startOn: string, endOnExclusive: string) {
  if (!isValidCalendarDate(startOn) || !isValidCalendarDate(endOnExclusive)) {
    throw new Error('Recurring forecast range must use valid calendar dates')
  }
  const span = (
    Date.parse(`${endOnExclusive}T00:00:00.000Z`)
    - Date.parse(`${startOn}T00:00:00.000Z`)
  ) / (24 * 60 * 60 * 1000)
  if (!Number.isSafeInteger(span) || span < 1) {
    throw new Error('Recurring forecast range must be a non-empty half-open range')
  }
  return span
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

export function recurringForecastPeriodsForRange(
  startOn: string,
  endOnExclusive: string,
  forecast: readonly ScheduledRecurringSummary[],
): RecurringForecastPeriod[] {
  if (calendarDaySpan(startOn, endOnExclusive) !== 35) {
    throw new Error('Recurring forecast periods require an exact 35-day range')
  }
  const boundaries = [0, 7, 14, 21, 28, 35].map((days) => addCalendarDays(startOn, days))
  const totals = Array.from({ length: 5 }, () => ({ incomeMinor: 0n, expenseMinor: 0n }))

  for (const rule of forecast) {
    if (!Number.isSafeInteger(rule.amountMinor) || rule.amountMinor < 0) {
      throw new Error('Recurring forecast amount must be a non-negative safe integer')
    }

    for (const occurrenceOn of rule.occurrenceDates) {
      if (occurrenceOn < startOn || occurrenceOn >= endOnExclusive) {
        throw new Error('Recurring forecast occurrence is outside the selected range')
      }
      const periodIndex = Math.floor(
        (calendarDaySpan(startOn, addCalendarDays(occurrenceOn, 1)) - 1) / 7,
      )
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

  return recurringForecastForRange(rules, start, end)
}

export function recurringForecastForRange(
  rules: readonly RecurringForecastRule[],
  startOn: string,
  endOnExclusive: string,
): ScheduledRecurringSummary[] {
  calendarDaySpan(startOn, endOnExclusive)

  return rules.flatMap((rule) => {
    const schedule = forecastScheduleForRange(rule, startOn, endOnExclusive)
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

  return recurringTransferForecastForRange(rules, start, end)
}

export function recurringTransferForecastForRange(
  rules: readonly RecurringTransferForecastRule[],
  startOn: string,
  endOnExclusive: string,
): ScheduledRecurringTransferSummary[] {
  calendarDaySpan(startOn, endOnExclusive)

  return rules.flatMap((rule) => {
    const schedule = forecastScheduleForRange(rule, startOn, endOnExclusive)
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

function forecastScheduleForRange(
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

  const lastOn = addCalendarDays(end, -1)
  const result = dueOccurrences(
    firstOccurrenceOn,
    lastOn,
    rule.frequency,
    rule.anchorDay,
    calendarDaySpan(firstOccurrenceOn, end),
  )
  if (result.truncated) throw new Error('Recurring forecast range was truncated')

  return {
    firstOccurrenceOn,
    occurrenceDates: result.occurrences.filter(
      (date) => !rule.scheduleEndsOn || date <= rule.scheduleEndsOn,
    ),
  }
}
