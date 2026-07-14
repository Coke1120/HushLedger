import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { addDemo, deleteDemo, demoAccounts, demoTransactions } from './demo'
import { buildDemoSnapshot } from './demoSnapshot'

function snapshot(
  currency?: 'HKD' | 'USD',
  duplicatesOnly = false,
  amountMinor: number | null = null,
  importReviewStatus: 'all' | 'unreviewed' | 'needs_follow_up' | 'reviewed' = 'all',
) {
  return buildDemoSnapshot(
    '2026-07',
    'all',
    '',
    null,
    null,
    null,
    null,
    'all',
    'date_desc',
    duplicatesOnly,
    'month',
    '',
    '',
    amountMinor,
    currency,
    importReviewStatus,
  )
}

describe('demo snapshot currency', () => {
  it('keeps all currency-bearing fallback data in the active ledger currency', () => {
    const usdSnapshot = snapshot('USD')

    assert.equal(usdSnapshot.ledgerSettings.currency, 'USD')
    assert.ok(usdSnapshot.transactions.length > 0)
    assert.ok(usdSnapshot.transactions.every(({ currency }) => currency === 'USD'))
    assert.ok(usdSnapshot.accounts.every(({ currency }) => currency === 'USD'))
  })

  it('does not mutate the shared demo fixtures when adapting a snapshot', () => {
    snapshot('USD')

    assert.ok(demoTransactions.every(({ currency }) => currency === 'HKD'))
    assert.ok(demoAccounts.every(({ currency }) => currency === 'HKD'))
    assert.ok(snapshot().transactions.every(({ currency }) => currency === 'HKD'))
    assert.ok(snapshot().accounts.every(({ currency }) => currency === 'HKD'))
  })

  it('normalizes currency before reviewing exact duplicates', () => {
    const original = demoTransactions[0]
    assert.ok(original)
    const duplicate = addDemo({
      id: '74f5ee4c-f066-4d76-91be-51c2a06c8d7a',
      type: original.type,
      amountMinor: original.amountMinor,
      currency: 'USD',
      accountId: original.accountId,
      categoryId: original.categoryId,
      occurredOn: original.occurredOn,
      cleared: !original.cleared,
      payee: original.payee,
      note: original.note,
    })

    try {
      const duplicateSnapshot = snapshot('USD', true)

      assert.deepEqual(
        new Set(duplicateSnapshot.transactions.map(({ id }) => id)),
        new Set([original.id, duplicate.id]),
      )
      assert.equal(duplicateSnapshot.transactionFilterSummary.transactionCount, 2)
      assert.ok(duplicateSnapshot.transactions.every(({ currency }) => currency === 'USD'))
    } finally {
      deleteDemo(duplicate.id)
    }
  })

  it('keeps exact-amount list and summary filters aligned', () => {
    const filtered = snapshot(undefined, false, 38_640)

    assert.deepEqual(filtered.transactions.map(({ amountMinor }) => amountMinor), [38_640])
    assert.deepEqual(filtered.transactionFilterSummary, {
      transactionCount: 1,
      currency: 'HKD',
      income: 0,
      expense: 38_640,
      net: -38_640,
    })
  })

  it('does not invent imported rows or allow an import-checklist filter to expose demo data', () => {
    assert.ok(snapshot().transactions.every(({ importReviewStatus }) => importReviewStatus == null))
    assert.deepEqual(snapshot(undefined, false, null, 'unreviewed').transactions, [])
    assert.deepEqual(snapshot(undefined, false, null, 'reviewed').transactionFilterSummary, {
      transactionCount: 0,
      currency: null,
      income: 0,
      expense: 0,
      net: 0,
    })
  })
})
