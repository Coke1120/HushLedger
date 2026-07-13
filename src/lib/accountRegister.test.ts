import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { calculateAccountRegisterBalances } from './accountRegister'

describe('account register balances', () => {
  it('attaches exact newest-first running balances to a complete activity list', () => {
    assert.deepEqual(
      calculateAccountRegisterBalances(10_000, -2_500, [-500, 1_000, -3_000]),
      {
        endingBalanceMinor: 7_500,
        runningNewestFirst: [7_500, 8_000, 7_000],
      },
    )
  })

  it('includes omitted older activity when only the newest entries are returned', () => {
    assert.deepEqual(
      calculateAccountRegisterBalances(100, 60, [30, 20]),
      {
        endingBalanceMinor: 160,
        runningNewestFirst: [160, 130],
      },
    )
  })

  it('can begin from a dated opening entry inside the selected month', () => {
    assert.deepEqual(
      calculateAccountRegisterBalances(0, 8_500, [-1_500, 10_000]),
      {
        endingBalanceMinor: 8_500,
        runningNewestFirst: [8_500, 10_000],
      },
    )
  })

  it('rejects arithmetic outside JavaScript safe-integer precision', () => {
    assert.throws(
      () => calculateAccountRegisterBalances(Number.MAX_SAFE_INTEGER, 1, [1]),
      /safe integer/,
    )
  })
})
