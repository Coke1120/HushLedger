import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildMonthlySpendingTrend } from './spendingTrend'

describe('legacy monthly spending trend compatibility', () => {
  it('keeps the selected month and previous five months zero-filled for cached clients', () => {
    assert.deepEqual(
      buildMonthlySpendingTrend('2026-01', [
        { month: '2025-08', amountMinor: 12_300, transactionCount: 2 },
        { month: '2026-01', amountMinor: 78_900, transactionCount: 4 },
      ]),
      [
        { month: '2025-08', amountMinor: 12_300, transactionCount: 2 },
        { month: '2025-09', amountMinor: 0, transactionCount: 0 },
        { month: '2025-10', amountMinor: 0, transactionCount: 0 },
        { month: '2025-11', amountMinor: 0, transactionCount: 0 },
        { month: '2025-12', amountMinor: 0, transactionCount: 0 },
        { month: '2026-01', amountMinor: 78_900, transactionCount: 4 },
      ],
    )
  })
})
