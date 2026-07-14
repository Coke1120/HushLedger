import { shiftMonth } from './date'
import type { SupportedCurrency } from './currency'
import type { AccountBalance, NetWorthTrendPoint } from './schema'

export const netWorthTrendMonthCount = 6

export function netWorthTrendMonths(selectedMonth: string) {
  return Array.from({ length: netWorthTrendMonthCount }, (_, index) => (
    shiftMonth(selectedMonth, index - (netWorthTrendMonthCount - 1))
  ))
}

export function buildNetWorthTrend(
  selectedMonth: string,
  balancesByMonth: ReadonlyMap<string, AccountBalance[]>,
  reportingCurrency: SupportedCurrency = 'HKD',
): NetWorthTrendPoint[] {
  return netWorthTrendMonths(selectedMonth).map((month) => {
    const balances = (balancesByMonth.get(month) ?? []).filter(
      (account) => account.currency === reportingCurrency,
    )
    const unavailableAccountCount = balances.filter(
      ({ recordedBalance }) => recordedBalance === null,
    ).length

    let netWorthMinor: number | null = null
    if (balances.length > 0 && unavailableAccountCount === 0) {
      netWorthMinor = balances.reduce((total, account) => {
        const next = total + (account.recordedBalance ?? 0)
        if (!Number.isSafeInteger(next)) {
          throw new Error('Net worth exceeds the safe integer range')
        }
        return next
      }, 0)
    }

    return {
      month,
      netWorthMinor,
      accountCount: balances.length,
      unavailableAccountCount,
    }
  })
}
