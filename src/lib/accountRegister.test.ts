import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  calculateAccountRegisterBalances,
  visibleAccountRegisterEntries,
} from './accountRegister'
import type { AccountRegisterEntry } from './schema'

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

describe('account register review filter', () => {
  const entries = [
    {
      entryId: 'uncleared-newest',
      cleared: false,
      runningBalanceMinor: 400,
    },
    { entryId: 'opening', cleared: null, runningBalanceMinor: 300 },
    { entryId: 'cleared', cleared: true, runningBalanceMinor: 200 },
    {
      entryId: 'uncleared-oldest',
      cleared: false,
      runningBalanceMinor: 100,
    },
  ] as AccountRegisterEntry[]

  it('preserves the complete loaded register by default', () => {
    assert.equal(visibleAccountRegisterEntries(entries, false), entries)
  })

  it('keeps only uncleared activity without changing source order or balances', () => {
    const before = entries.map(({ entryId, cleared, runningBalanceMinor }) => ({
      entryId,
      cleared,
      runningBalanceMinor,
    }))
    const visible = visibleAccountRegisterEntries(entries, true)

    assert.deepEqual(
      visible.map(({ entryId, runningBalanceMinor }) => ({
        entryId,
        runningBalanceMinor,
      })),
      [
        { entryId: 'uncleared-newest', runningBalanceMinor: 400 },
        { entryId: 'uncleared-oldest', runningBalanceMinor: 100 },
      ],
    )
    assert.equal(visible[0], entries[0])
    assert.equal(visible[1], entries[3])
    assert.deepEqual(
      entries.map(({ entryId, cleared, runningBalanceMinor }) => ({
        entryId,
        cleared,
        runningBalanceMinor,
      })),
      before,
    )
  })

  it('returns no visible activity after the final uncleared entry is cleared', () => {
    const finalUncleared = [
      { entryId: 'already-cleared', cleared: true },
      { entryId: 'final-uncleared', cleared: false },
    ] as AccountRegisterEntry[]

    assert.deepEqual(
      visibleAccountRegisterEntries(
        finalUncleared.map((entry) => ({ ...entry, cleared: true })),
        true,
      ),
      [],
    )
  })
})
