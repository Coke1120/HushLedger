import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { translate, type Locale, type Translator } from '../i18n'
import {
  addDemo,
  deleteDemo,
  demoCategories,
  demoSummary,
  getDemoTransactions,
  setDemoTransactionsCategory,
  setDemoTransactionsClearing,
  summarizeDemoTransactions,
  updateDemo,
} from './demo'

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

  it('keeps an exact built-in payee filter valid after the locale changes', () => {
    const englishPayee = getDemoTransactions('2026-07', 'expense', '', translator('en'))
      .find(({ id }) => id === '7598bb40-b9ac-4cf9-b81e-d0a0f8f9334f')?.payee
    assert.equal(englishPayee, 'Monthly rent')

    const frenchRows = getDemoTransactions(
      '2026-07', 'expense', '', translator('fr'), null, null, null, 'all', 'date_desc', false,
      'month', null, null, englishPayee,
    )
    assert.equal(frenchRows.length, 1)
    assert.equal(frenchRows[0]?.payee, 'Loyer mensuel')
    assert.equal(summarizeDemoTransactions(
      '2026-07', 'expense', '', translator('fr'), null, null, null, 'all', false,
      'month', null, null, englishPayee,
    ).transactionCount, 1)
  })

  it('stacks account and category filters without changing the monthly summary', () => {
    const bankFood = getDemoTransactions('2026-07', 'all', '', undefined, 2, 3)
    const creditFood = getDemoTransactions('2026-07', 'expense', '', undefined, 3, 3)

    assert.deepEqual(bankFood, [])
    assert.equal(creditFood.length, 1)
    assert.equal(creditFood[0]?.accountId, 3)
    assert.equal(creditFood[0]?.categoryId, 3)
  })

  it('filters cleared and uncleared demo transactions independently', () => {
    const uncleared = getDemoTransactions(
      '2026-07',
      'all',
      '',
      undefined,
      null,
      null,
      null,
      'uncleared',
    )

    assert.equal(uncleared.length, 1)
    assert.equal(uncleared[0]?.cleared, false)
  })

  it('keeps monthly review bounded while allowing an explicit all-history search', () => {
    const original = getDemoTransactions('2026-07', 'all', '')[0]
    assert(original)
    const prior = {
      id: 'f8bab109-1c48-4dc9-b759-d763444bcb1d',
      type: original.type,
      amountMinor: original.amountMinor,
      currency: original.currency,
      accountId: original.accountId,
      categoryId: original.categoryId,
      occurredOn: '2026-06-30',
      cleared: original.cleared,
      payee: 'Cross-month needle',
      note: '',
    }

    try {
      addDemo(prior)
      assert.equal(getDemoTransactions('2026-07', 'all', 'Cross-month needle').length, 0)
      assert.equal(getDemoTransactions(
        '2026-07', 'all', 'Cross-month needle', undefined, null, null, null, 'all',
        'date_desc', false, 'all',
      ).length, 1)
      assert.equal(summarizeDemoTransactions(
        '2026-07', 'all', 'Cross-month needle', undefined, null, null, null, 'all', false, 'all',
      ).transactionCount, 1)
      assert.equal(getDemoTransactions(
        '2026-07', 'all', 'Cross-month needle', undefined, null, null, null, 'all',
        'date_desc', false, 'range', '2026-06-30', '2026-06-30',
      ).length, 1)
      assert.deepEqual(summarizeDemoTransactions(
        '2026-07', 'all', 'Cross-month needle', undefined, null, null, null, 'all', false,
        'range', '2026-06-30', '2026-06-30',
      ), {
        transactionCount: 1,
        income: 0,
        expense: prior.amountMinor,
        net: -prior.amountMinor,
      })
    } finally {
      deleteDemo(prior.id)
    }
  })

  it('changes selected clearing states atomically with version checks', () => {
    const originals = getDemoTransactions('2026-07', 'all', '').filter(({ cleared }) => cleared).slice(0, 2)
    assert.equal(originals.length, 2)
    const versions = originals.map(({ id, updatedAt }) => ({ id, updatedAt }))

    try {
      assert.deepEqual(setDemoTransactionsClearing({
        cleared: false,
        transactions: versions.map((version, index) => (
          index === 1 ? { ...version, updatedAt: '2026-01-01T00:00:00.000Z' } : version
        )),
      }), { kind: 'version_conflict' })
      assert(originals.every(({ id }) => (
        getDemoTransactions('2026-07', 'all', '').find((item) => item.id === id)?.cleared === true
      )))

      assert.deepEqual(setDemoTransactionsClearing({ cleared: false, transactions: versions }), {
        kind: 'updated',
        count: 2,
      })
      assert(originals.every(({ id }) => (
        getDemoTransactions('2026-07', 'all', '').find((item) => item.id === id)?.cleared === false
      )))
    } finally {
      const current = getDemoTransactions('2026-07', 'all', '')
      const restored = setDemoTransactionsClearing({
        cleared: true,
        transactions: originals.map(({ id }) => {
          const transaction = current.find((item) => item.id === id)
          assert(transaction)
          return { id, updatedAt: transaction.updatedAt }
        }),
      })
      assert.equal(restored.kind, 'updated')
    }
  })

  it('recategorizes only same-type demo transactions with current versions', () => {
    const source = getDemoTransactions('2026-07', 'expense', '')[0]
    const target = demoCategories.find(({ id, isActive, type }) => (
      isActive && type === 'expense' && id !== source?.categoryId
    ))
    const incomeCategory = demoCategories.find(({ isActive, type }) => isActive && type === 'income')
    assert(source)
    assert(target)
    assert(incomeCategory)

    const ids = [
      '40000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000002',
    ]

    try {
      ids.forEach((id, index) => addDemo({
        id,
        type: 'expense',
        amountMinor: 100 + index,
        currency: 'HKD',
        accountId: source.accountId,
        categoryId: source.categoryId,
        occurredOn: `2026-07-${20 + index}`,
        cleared: false,
        payee: `Bulk category ${index + 1}`,
        note: '',
      }))
      const originals = getDemoTransactions('2026-07', 'expense', 'Bulk category')
      const versions = originals.map(({ id, updatedAt }) => ({ id, updatedAt }))
      assert.equal(versions.length, 2)

      assert.deepEqual(setDemoTransactionsCategory({
        categoryId: target.id,
        transactions: versions.map((version, index) => (
          index === 1 ? { ...version, updatedAt: '2026-01-01T00:00:00.000Z' } : version
        )),
      }), { kind: 'version_conflict' })
      assert(originals.every(({ id }) => (
        getDemoTransactions('2026-07', 'expense', 'Bulk category').find((item) => item.id === id)?.categoryId
          === source.categoryId
      )))

      assert.deepEqual(setDemoTransactionsCategory({
        categoryId: incomeCategory.id,
        transactions: versions,
      }), { kind: 'reference_invalid', code: 'CATEGORY_TYPE_MISMATCH' })
      assert.deepEqual(setDemoTransactionsCategory({ categoryId: target.id, transactions: versions }), {
        kind: 'updated',
        count: 2,
      })
      assert(ids.every((id) => (
        getDemoTransactions('2026-07', 'expense', 'Bulk category').find((item) => item.id === id)?.categoryId
          === target.id
      )))
    } finally {
      ids.forEach((id) => {
        if (getDemoTransactions('2026-07', 'expense', 'Bulk category').some((item) => item.id === id)) {
          deleteDemo(id)
        }
      })
    }
  })

  it('sorts demo transactions with the same bounded ordering choices as the live ledger', () => {
    const largestFirst = getDemoTransactions(
      '2026-07', 'all', '', undefined, null, null, null, 'all', 'amount_desc',
    )
    const oldestFirst = getDemoTransactions(
      '2026-07', 'all', '', undefined, null, null, null, 'all', 'date_asc',
    )

    assert(largestFirst.every((row, index) => index === 0 || largestFirst[index - 1]!.amountMinor >= row.amountMinor))
    assert(oldestFirst.every((row, index) => index === 0 || oldestFirst[index - 1]!.occurredOn <= row.occurredOn))
  })

  it('summarizes the complete filtered demo result with signed net money', () => {
    assert.deepEqual(
      summarizeDemoTransactions(
        '2026-07',
        'expense',
        'supermarket',
        translator('en'),
        3,
        3,
        null,
        'uncleared',
      ),
      {
        transactionCount: 1,
        income: 0,
        expense: 38_640,
        net: -38_640,
      },
    )
  })

  it('finds only field-identical demo transactions while ignoring clearing status', () => {
    const original = getDemoTransactions('2026-07', 'all', '')[0]
    assert(original)
    const duplicate = addDemo({
      id: 'b557d0d8-e484-48f5-a600-d677cc7318bf',
      type: original.type,
      amountMinor: original.amountMinor,
      currency: original.currency,
      accountId: original.accountId,
      categoryId: original.categoryId,
      occurredOn: original.occurredOn,
      cleared: !original.cleared,
      payee: original.payee,
      note: original.note,
    })

    try {
      const duplicates = getDemoTransactions(
        '2026-07', 'all', '', undefined, null, null, null, 'all', 'date_desc', true,
      )
      assert.deepEqual(new Set(duplicates.map(({ id }) => id)), new Set([original.id, duplicate.id]))
      assert.deepEqual(
        summarizeDemoTransactions(
          '2026-07', 'all', '', undefined, null, null, null, 'all', true,
        ),
        {
          transactionCount: 2,
          income: 0,
          expense: original.amountMinor * 2,
          net: original.amountMinor * -2,
        },
      )
    } finally {
      deleteDemo(duplicate.id)
    }
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
    assert.deepEqual(
      summary.monthlySpendingPlans.map(({ categoryId, plannedMinor, spentMinor }) => ({
        categoryId,
        plannedMinor,
        spentMinor,
      })),
      [
        { categoryId: 3, plannedMinor: 50_000, spentMinor: 45_440 },
        { categoryId: 6, plannedMinor: 1_500_000, spentMinor: 1_550_000 },
        { categoryId: 7, plannedMinor: 120_000, spentMinor: 118_300 },
      ],
    )
  })

  it('groups monthly expense payees consistently and supports an exact payee drill-down', () => {
    const source = getDemoTransactions('2026-07', 'expense', '')[0]
    assert(source)
    const ids = [
      '50000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000002',
      '50000000-0000-4000-8000-000000000003',
    ]

    try {
      addDemo({
        id: ids[0],
        type: 'expense',
        amountMinor: 125,
        currency: 'HKD',
        accountId: source.accountId,
        categoryId: source.categoryId,
        occurredOn: '2026-07-25',
        cleared: true,
        payee: '  Corner Shop  ',
        note: '',
      })
      addDemo({
        id: ids[1],
        type: 'expense',
        amountMinor: 275,
        currency: 'HKD',
        accountId: source.accountId,
        categoryId: source.categoryId,
        occurredOn: '2026-07-26',
        cleared: true,
        payee: 'corner shop',
        note: '',
      })
      addDemo({
        id: ids[2],
        type: 'expense',
        amountMinor: 500,
        currency: 'HKD',
        accountId: source.accountId,
        categoryId: source.categoryId,
        occurredOn: '2026-07-27',
        cleared: true,
        payee: '   ',
        note: '',
      })

      assert.deepEqual(
        demoSummary('2026-07').expenseByPayee.find(({ payee }) => payee === 'Corner Shop'),
        { payee: 'Corner Shop', amountMinor: 400, transactionCount: 2 },
      )
      assert.equal(demoSummary('2026-07').expenseByPayee.some(({ payee }) => payee === ''), false)
      assert.deepEqual(
        getDemoTransactions(
          '2026-07', 'expense', '', undefined, null, null, null, 'all', 'date_desc', false,
          'month', null, null, '  CORNER SHOP ',
        ).map(({ id }) => id),
        [ids[1], ids[0]],
      )
    } finally {
      ids.forEach((id) => deleteDemo(id))
    }
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
      cleared: true,
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
