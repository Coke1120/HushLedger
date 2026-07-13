import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { translate, type Locale, type Translator } from '../i18n'
import { deleteDemo, demoSummary, getDemoTransactions, updateDemo } from './demo'

function translator(locale: Locale): Translator {
  return (key, values) => translate(locale, key, values)
}

describe('localized demo data', () => {
  for (const [locale, expected] of [
    ['zh-Hant', '超級市場'],
    ['en', 'Supermarket'],
    ['ja', 'スーパーマーケット'],
    ['fr', 'Supermarché'],
  ] satisfies ReadonlyArray<readonly [Locale, string]>) {
    it(`localizes built-in demo copy for ${locale}`, () => {
      const transactions = getDemoTransactions('2026-07', 'all', '', translator(locale))
      assert.equal(transactions[0]?.payee, expected)
    })
  }

  it('searches localized demo copy', () => {
    assert.equal(getDemoTransactions('2026-07', 'all', 'supermarket', translator('en')).length, 1)
    assert.equal(getDemoTransactions('2026-07', 'all', 'supermarché', translator('fr')).length, 1)
  })

  it('stacks account and category filters without changing the monthly summary', () => {
    const bankFood = getDemoTransactions('2026-07', 'all', '', undefined, 2, 3)
    const creditFood = getDemoTransactions('2026-07', 'expense', '', undefined, 3, 3)

    assert.deepEqual(bankFood, [])
    assert.equal(creditFood.length, 1)
    assert.equal(creditFood[0]?.accountId, 3)
    assert.equal(creditFood[0]?.categoryId, 3)
  })

  it('ranks monthly expense categories by exact total and retains transaction counts', () => {
    const summary = demoSummary('2026-07')

    assert.equal(summary.expense, 1_717_950)
    assert.deepEqual(
      summary.expenseByCategory.map(({ categoryId, amountMinor, transactionCount }) => ({
        categoryId,
        amountMinor,
        transactionCount,
      })),
      [
        { categoryId: 6, amountMinor: 1_550_000, transactionCount: 1 },
        { categoryId: 7, amountMinor: 118_300, transactionCount: 2 },
        { categoryId: 3, amountMinor: 45_440, transactionCount: 2 },
        { categoryId: 4, amountMinor: 4_210, transactionCount: 1 },
      ],
    )
    assert.deepEqual(summary.spendingTrend, [
      { month: '2026-02', amountMinor: 0, transactionCount: 0 },
      { month: '2026-03', amountMinor: 0, transactionCount: 0 },
      { month: '2026-04', amountMinor: 0, transactionCount: 0 },
      { month: '2026-05', amountMinor: 0, transactionCount: 0 },
      { month: '2026-06', amountMinor: 0, transactionCount: 0 },
      { month: '2026-07', amountMinor: 1_717_950, transactionCount: 6 },
    ])
  })

  it('keeps edits and deletions local to the current demo session', () => {
    const original = getDemoTransactions('2026-07', 'all', '')[0]
    assert(original)
    const updated = updateDemo({
      id: original.id,
      type: original.type,
      amountMinor: 12_345,
      currency: original.currency,
      accountId: original.accountId,
      categoryId: original.categoryId,
      occurredOn: original.occurredOn,
      payee: 'Edited demo merchant',
      note: 'Session only',
    })
    assert.equal(updated.createdAt, original.createdAt)
    assert.equal(
      getDemoTransactions('2026-07', 'all', '', translator('en'))[0]?.payee,
      'Edited demo merchant',
    )

    deleteDemo(original.id)
    assert.equal(getDemoTransactions('2026-07', 'all', '').some(({ id }) => id === original.id), false)
  })
})
