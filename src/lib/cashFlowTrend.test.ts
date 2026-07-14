import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildLegacySpendingTrendRows,
  buildMonthlyCashFlowTrend,
  compareSelectedMonthCashFlow,
} from './cashFlowTrend'

describe('monthly recorded cash-flow trend', () => {
  it('fills the selected month and previous five calendar months in chronological order', () => {
    assert.deepEqual(
      buildMonthlyCashFlowTrend('2026-01', [
        { month: '2025-08', incomeMinor: 80_000, expenseMinor: 12_300, transactionCount: 3 },
        { month: '2025-11', incomeMinor: 0, expenseMinor: 45_600, transactionCount: 3 },
        { month: '2026-01', incomeMinor: 78_900, expenseMinor: 90_000, transactionCount: 4 },
      ]),
      [
        { month: '2025-08', incomeMinor: 80_000, expenseMinor: 12_300, netMinor: 67_700, transactionCount: 3 },
        { month: '2025-09', incomeMinor: 0, expenseMinor: 0, netMinor: 0, transactionCount: 0 },
        { month: '2025-10', incomeMinor: 0, expenseMinor: 0, netMinor: 0, transactionCount: 0 },
        { month: '2025-11', incomeMinor: 0, expenseMinor: 45_600, netMinor: -45_600, transactionCount: 3 },
        { month: '2025-12', incomeMinor: 0, expenseMinor: 0, netMinor: 0, transactionCount: 0 },
        { month: '2026-01', incomeMinor: 78_900, expenseMinor: 90_000, netMinor: -11_100, transactionCount: 4 },
      ],
    )
  })

  it('ignores aggregate rows outside the six-month review window', () => {
    assert.deepEqual(
      buildMonthlyCashFlowTrend('2026-07', [
        { month: '2026-01', incomeMinor: 99_900, expenseMinor: 0, transactionCount: 1 },
        { month: '2026-02', incomeMinor: 0, expenseMinor: 12_300, transactionCount: 2 },
        { month: '2026-08', incomeMinor: 88_800, expenseMinor: 0, transactionCount: 1 },
      ]),
      [
        { month: '2026-02', incomeMinor: 0, expenseMinor: 12_300, netMinor: -12_300, transactionCount: 2 },
        { month: '2026-03', incomeMinor: 0, expenseMinor: 0, netMinor: 0, transactionCount: 0 },
        { month: '2026-04', incomeMinor: 0, expenseMinor: 0, netMinor: 0, transactionCount: 0 },
        { month: '2026-05', incomeMinor: 0, expenseMinor: 0, netMinor: 0, transactionCount: 0 },
        { month: '2026-06', incomeMinor: 0, expenseMinor: 0, netMinor: 0, transactionCount: 0 },
        { month: '2026-07', incomeMinor: 0, expenseMinor: 0, netMinor: 0, transactionCount: 0 },
      ],
    )
  })

  it('marks unsafe aggregate amounts unavailable instead of presenting rounded money', () => {
    assert.deepEqual(
      buildMonthlyCashFlowTrend('2026-07', [{
        month: '2026-07',
        incomeMinor: Number.MAX_SAFE_INTEGER + 1,
        expenseMinor: 12_300,
        transactionCount: 2,
      }]).at(-1),
      {
        month: '2026-07',
        incomeMinor: null,
        expenseMinor: 12_300,
        netMinor: null,
        transactionCount: 2,
      },
    )

    assert.deepEqual(
      buildMonthlyCashFlowTrend('2026-07', [{
        month: '2026-07',
        incomeMinor: 45_600,
        expenseMinor: Number.MAX_SAFE_INTEGER + 1,
        transactionCount: 2,
      }]).at(-1),
      {
        month: '2026-07',
        incomeMinor: 45_600,
        expenseMinor: null,
        netMinor: null,
        transactionCount: 2,
      },
    )
  })

  it('rejects an unsafe transaction count rather than reporting a false count', () => {
    assert.throws(
      () => buildMonthlyCashFlowTrend('2026-07', [{
        month: '2026-07',
        incomeMinor: 100,
        expenseMinor: 50,
        transactionCount: Number.MAX_SAFE_INTEGER + 1,
      }]),
      /transaction count exceeds the safe integer range/,
    )
  })

  it('fails closed rather than publishing unsafe money to cached clients', () => {
    assert.throws(
      () => buildLegacySpendingTrendRows([{
        month: '2026-07',
        incomeMinor: 0,
        expenseMinor: Number.MAX_SAFE_INTEGER + 1,
        transactionCount: 1,
        expenseTransactionCount: 1,
      }]),
      /Legacy spending trend exceeds the safe integer range/,
    )
    assert.throws(
      () => buildLegacySpendingTrendRows([{
        month: '2026-07',
        incomeMinor: 0,
        expenseMinor: 100,
        transactionCount: 1,
        expenseTransactionCount: Number.MAX_SAFE_INTEGER + 1,
      }]),
      /Legacy spending trend transaction count exceeds the safe integer range/,
    )
  })
})

describe('selected-month recorded cash-flow comparison', () => {
  const points = buildMonthlyCashFlowTrend('2026-07', [
    { month: '2026-06', incomeMinor: 125_000, expenseMinor: 91_000, transactionCount: 7 },
    { month: '2026-07', incomeMinor: 140_000, expenseMinor: 103_500, transactionCount: 8 },
  ])

  it('compares exact income, expense, and net amounts with the previous calendar month', () => {
    assert.deepEqual(compareSelectedMonthCashFlow('2026-07', points), {
      previousMonth: '2026-06',
      incomeDifferenceMinor: 15_000,
      expenseDifferenceMinor: 12_500,
      netDifferenceMinor: 2_500,
    })
  })

  it('keeps decreases and no-change values neutral and exact', () => {
    assert.deepEqual(compareSelectedMonthCashFlow('2026-07', [
      { month: '2026-06', incomeMinor: 100, expenseMinor: 80, netMinor: 20, transactionCount: 2 },
      { month: '2026-07', incomeMinor: 50, expenseMinor: 80, netMinor: -30, transactionCount: 2 },
    ]), {
      previousMonth: '2026-06',
      incomeDifferenceMinor: -50,
      expenseDifferenceMinor: 0,
      netDifferenceMinor: -50,
    })
  })

  it('fails closed per amount when either month is unavailable or the difference is unsafe', () => {
    assert.deepEqual(compareSelectedMonthCashFlow('2026-07', [
      {
        month: '2026-06',
        incomeMinor: Number.MAX_SAFE_INTEGER,
        expenseMinor: null,
        netMinor: -Number.MAX_SAFE_INTEGER,
        transactionCount: 2,
      },
      {
        month: '2026-07',
        incomeMinor: 0,
        expenseMinor: 50,
        netMinor: 50,
        transactionCount: 2,
      },
    ]), {
      previousMonth: '2026-06',
      incomeDifferenceMinor: -Number.MAX_SAFE_INTEGER,
      expenseDifferenceMinor: null,
      netDifferenceMinor: null,
    })

    assert.equal(compareSelectedMonthCashFlow('2026-07', [
      {
        month: '2026-06',
        incomeMinor: 0,
        expenseMinor: 0,
        netMinor: Number.MAX_SAFE_INTEGER,
        transactionCount: 0,
      },
      {
        month: '2026-07',
        incomeMinor: 0,
        expenseMinor: 0,
        netMinor: Number.MIN_SAFE_INTEGER,
        transactionCount: 0,
      },
    ])?.netDifferenceMinor, null)
  })

  it('omits the comparison when either calendar month is missing', () => {
    assert.equal(compareSelectedMonthCashFlow('2026-07', points.slice(-1)), null)
    assert.equal(compareSelectedMonthCashFlow('2026-08', points), null)
  })
})
