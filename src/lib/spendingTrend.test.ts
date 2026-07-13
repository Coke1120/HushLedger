import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildMonthlySpendingTrend } from './spendingTrend'

describe('monthly spending trend', () => {
  it('fills the selected month and previous five calendar months in chronological order', () => {
    assert.deepEqual(
      buildMonthlySpendingTrend('2026-01', [
        { month: '2025-08', amountMinor: 12_300, transactionCount: 2 },
        { month: '2025-11', amountMinor: 45_600, transactionCount: 3 },
        { month: '2026-01', amountMinor: 78_900, transactionCount: 4 },
      ]),
      [
        { month: '2025-08', amountMinor: 12_300, transactionCount: 2 },
        { month: '2025-09', amountMinor: 0, transactionCount: 0 },
        { month: '2025-10', amountMinor: 0, transactionCount: 0 },
        { month: '2025-11', amountMinor: 45_600, transactionCount: 3 },
        { month: '2025-12', amountMinor: 0, transactionCount: 0 },
        { month: '2026-01', amountMinor: 78_900, transactionCount: 4 },
      ],
    )
  })

  it('ignores aggregate rows outside the six-month review window', () => {
    assert.deepEqual(
      buildMonthlySpendingTrend('2026-07', [
        { month: '2026-01', amountMinor: 99_900, transactionCount: 1 },
        { month: '2026-02', amountMinor: 12_300, transactionCount: 2 },
        { month: '2026-08', amountMinor: 88_800, transactionCount: 1 },
      ]),
      [
        { month: '2026-02', amountMinor: 12_300, transactionCount: 2 },
        { month: '2026-03', amountMinor: 0, transactionCount: 0 },
        { month: '2026-04', amountMinor: 0, transactionCount: 0 },
        { month: '2026-05', amountMinor: 0, transactionCount: 0 },
        { month: '2026-06', amountMinor: 0, transactionCount: 0 },
        { month: '2026-07', amountMinor: 0, transactionCount: 0 },
      ],
    )
  })
})
