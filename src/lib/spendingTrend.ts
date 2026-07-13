import { shiftMonth } from './date'
import type { MonthlySpendingSummary } from './schema'

const spendingTrendMonthCount = 6

export function buildMonthlySpendingTrend(
  selectedMonth: string,
  rows: MonthlySpendingSummary[],
): MonthlySpendingSummary[] {
  const rowsByMonth = new Map(rows.map((row) => [row.month, row]))

  return Array.from({ length: spendingTrendMonthCount }, (_, index) => {
    const month = shiftMonth(selectedMonth, index - (spendingTrendMonthCount - 1))
    return rowsByMonth.get(month) ?? { month, amountMinor: 0, transactionCount: 0 }
  })
}
