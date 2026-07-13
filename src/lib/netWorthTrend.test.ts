import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AccountBalance } from './schema'
import { buildNetWorthTrend, netWorthTrendMonths } from './netWorthTrend'

function balance(recordedBalance: number | null): AccountBalance {
  return {
    accountId: 1,
    accountName: 'Bank',
    accountLocalizationKey: null,
    accountType: 'bank',
    isActive: true,
    openingBalanceMinor: null,
    openingBalanceOn: null,
    recordedBalance,
    clearedBalance: recordedBalance,
    unclearedBalance: recordedBalance === null ? null : 0,
  }
}

describe('net worth trend', () => {
  it('uses the selected month and previous five calendar months in chronological order', () => {
    assert.deepEqual(netWorthTrendMonths('2026-01'), [
      '2025-08',
      '2025-09',
      '2025-10',
      '2025-11',
      '2025-12',
      '2026-01',
    ])
  })

  it('adds signed balances across every account without treating debt as an asset', () => {
    const trend = buildNetWorthTrend('2026-07', new Map([
      ['2026-07', [balance(250_000), { ...balance(-75_000), accountId: 2 }]],
    ]))

    assert.deepEqual(trend.at(-1), {
      month: '2026-07',
      netWorthMinor: 175_000,
      accountCount: 2,
      unavailableAccountCount: 0,
    })
  })

  it('marks a month unavailable instead of silently omitting unknown account history', () => {
    const trend = buildNetWorthTrend('2026-07', new Map([
      ['2026-06', [balance(250_000), { ...balance(null), accountId: 2 }]],
      ['2026-07', [balance(260_000), { ...balance(-70_000), accountId: 2 }]],
    ]))

    assert.deepEqual(trend.at(-2), {
      month: '2026-06',
      netWorthMinor: null,
      accountCount: 2,
      unavailableAccountCount: 1,
    })
    assert.equal(trend.at(-1)?.netWorthMinor, 190_000)
  })

  it('keeps an empty ledger distinct from a zero net worth', () => {
    const trend = buildNetWorthTrend('2026-07', new Map())
    assert.deepEqual(trend.at(-1), {
      month: '2026-07',
      netWorthMinor: null,
      accountCount: 0,
      unavailableAccountCount: 0,
    })
  })

  it('rejects totals outside JavaScript safe-integer precision', () => {
    assert.throws(
      () => buildNetWorthTrend('2026-07', new Map([
        ['2026-07', [balance(Number.MAX_SAFE_INTEGER), { ...balance(1), accountId: 2 }]],
      ])),
      /safe integer/,
    )
  })
})
