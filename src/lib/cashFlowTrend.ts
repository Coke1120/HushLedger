import { shiftMonth } from './date'
import type { MonthlyCashFlowSummary, MonthlySpendingSummary } from './schema'

const cashFlowTrendMonthCount = 6

export type MonthlyCashFlowAggregate = {
  month: string
  incomeMinor: number
  expenseMinor: number
  transactionCount: number
}

export type MonthlyCashFlowQueryRow = MonthlyCashFlowAggregate & {
  expenseTransactionCount: number
}

/** @deprecated Retained temporarily for cached clients during the cash-flow trend transition. */
export function buildLegacySpendingTrendRows(
  rows: readonly MonthlyCashFlowQueryRow[],
): MonthlySpendingSummary[] {
  return rows.map((row) => {
    if (!Number.isSafeInteger(row.expenseMinor) || row.expenseMinor < 0) {
      throw new Error('Legacy spending trend exceeds the safe integer range')
    }
    if (!Number.isSafeInteger(row.expenseTransactionCount) || row.expenseTransactionCount < 0) {
      throw new Error('Legacy spending trend transaction count exceeds the safe integer range')
    }
    return {
      month: row.month,
      amountMinor: row.expenseMinor,
      transactionCount: row.expenseTransactionCount,
    }
  })
}

export function buildMonthlyCashFlowTrend(
  selectedMonth: string,
  rows: readonly MonthlyCashFlowAggregate[],
): MonthlyCashFlowSummary[] {
  const rowsByMonth = new Map(rows.map((row) => [row.month, row]))

  return Array.from({ length: cashFlowTrendMonthCount }, (_, index) => {
    const month = shiftMonth(selectedMonth, index - (cashFlowTrendMonthCount - 1))
    const row = rowsByMonth.get(month)
    if (!row) {
      return {
        month,
        incomeMinor: 0,
        expenseMinor: 0,
        netMinor: 0,
        transactionCount: 0,
      }
    }
    if (!Number.isSafeInteger(row.transactionCount) || row.transactionCount < 0) {
      throw new Error('Cash-flow transaction count exceeds the safe integer range')
    }

    const incomeMinor = nonNegativeSafeIntegerOrNull(row.incomeMinor)
    const expenseMinor = nonNegativeSafeIntegerOrNull(row.expenseMinor)
    const netMinor = incomeMinor === null || expenseMinor === null
      ? null
      : safeDifferenceOrNull(incomeMinor, expenseMinor)

    return {
      month,
      incomeMinor,
      expenseMinor,
      netMinor,
      transactionCount: row.transactionCount,
    }
  })
}

function nonNegativeSafeIntegerOrNull(value: number) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

function safeDifferenceOrNull(left: number, right: number) {
  const result = left - right
  return Number.isSafeInteger(result) ? result : null
}
