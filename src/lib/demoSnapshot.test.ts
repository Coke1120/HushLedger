import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { addDemo, deleteDemo, demoAccounts, demoTransactions } from './demo'
import { buildDemoSnapshot } from './demoSnapshot'

function snapshot(currency?: 'HKD' | 'USD', duplicatesOnly = false) {
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
    currency,
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
})
