import { isValidCalendarDate } from './date'

export type RecurringAmountReview = {
  latestGeneratedAmountMinor: number
  latestGeneratedDueOn: string
  futureAmountMinor: number
}

export function getRecurringAmountReview(rule: {
  amountMinor: unknown
  latestGeneratedAmountMinor?: unknown
  latestGeneratedDueOn?: unknown
}): RecurringAmountReview | null {
  const { amountMinor, latestGeneratedAmountMinor, latestGeneratedDueOn } = rule
  if (
    !Number.isSafeInteger(amountMinor)
    || Number(amountMinor) <= 0
    || !Number.isSafeInteger(latestGeneratedAmountMinor)
    || Number(latestGeneratedAmountMinor) <= 0
    || typeof latestGeneratedDueOn !== 'string'
    || !isValidCalendarDate(latestGeneratedDueOn)
    || amountMinor === latestGeneratedAmountMinor
  ) return null

  return {
    latestGeneratedAmountMinor: Number(latestGeneratedAmountMinor),
    latestGeneratedDueOn,
    futureAmountMinor: Number(amountMinor),
  }
}
