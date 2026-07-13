import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  accountCreateSchema,
  accountTransferInputSchema,
  accountTransferQuerySchema,
  accountTransferUpdateSchema,
  accountUpdateSchema,
  categoryCreateSchema,
  categoryUpdateSchema,
  referenceIdSchema,
  referenceOrderSchema,
  referenceStatusSchema,
  recurringRuleCreateSchema,
  recurringRuleDeleteSchema,
  recurringRuleSkipSchema,
  recurringRuleStatusSchema,
  recurringRuleUpdateSchema,
  transactionDeleteSchema,
  transactionCategoryBatchSchema,
  transactionClearingBatchSchema,
  transactionDuplicateCheckSchema,
  transactionInputSchema,
  transactionQuerySchema,
  transactionUpdateSchema,
} from './schema'

describe('reference data validation', () => {
  const updatedAt = '2026-07-11T10:30:00.000Z'

  it('accepts strict account and category mutations', () => {
    assert.deepEqual(accountCreateSchema.parse({ name: 'Savings', type: 'bank' }), {
      name: 'Savings',
      type: 'bank',
      openingBalanceMinor: null,
      openingBalanceOn: null,
    })
    assert.equal(accountUpdateSchema.safeParse({
      name: 'Cash',
      type: 'cash',
      openingBalanceMinor: -12_345,
      openingBalanceOn: '2026-07-01',
      updatedAt,
    }).success, true)
    assert.deepEqual(categoryCreateSchema.parse({
      name: 'Education',
      type: 'expense',
      monthlyPlanMinor: 25_000,
    }), {
      name: 'Education',
      type: 'expense',
      monthlyPlanMinor: 25_000,
    })
    assert.deepEqual(categoryCreateSchema.parse({ name: 'Gift', type: 'income' }), {
      name: 'Gift',
      type: 'income',
      monthlyPlanMinor: null,
    })
    assert.equal(categoryUpdateSchema.safeParse({
      name: 'Books',
      type: 'expense',
      monthlyPlanMinor: null,
      updatedAt,
    }).success, true)
    assert.equal(referenceStatusSchema.safeParse({ isActive: false, updatedAt }).success, true)
    assert.equal(referenceOrderSchema.safeParse({
      items: [{ id: 2, updatedAt }, { id: 1, updatedAt }],
    }).success, true)
    assert.equal(referenceIdSchema.parse('42'), 42)
  })

  it('rejects empty names, unknown types, and extra fields', () => {
    assert.equal(accountCreateSchema.safeParse({ name: ' ', type: 'bank' }).success, false)
    assert.equal(accountCreateSchema.safeParse({ name: 'Card', type: 'loan' }).success, false)
    assert.equal(accountCreateSchema.safeParse({
      name: 'Card',
      type: 'credit_card',
      openingBalanceMinor: -10_000,
    }).success, false)
    assert.equal(accountUpdateSchema.safeParse({
      name: 'Cash',
      type: 'cash',
      openingBalanceMinor: null,
      openingBalanceOn: '2026-07-01',
      updatedAt,
    }).success, false)
    assert.equal(categoryCreateSchema.safeParse({ name: 'Food', type: 'transfer' }).success, false)
    assert.equal(
      categoryCreateSchema.safeParse({
        name: 'Salary',
        type: 'income',
        monthlyPlanMinor: 100_000,
      }).success,
      false,
    )
    assert.equal(
      categoryUpdateSchema.safeParse({
        name: 'Salary',
        type: 'income',
        monthlyPlanMinor: 100_000,
        updatedAt,
      }).success,
      false,
    )
    assert.equal(
      categoryUpdateSchema.safeParse({
        name: 'Food',
        type: 'expense',
        monthlyPlanMinor: Number.MAX_SAFE_INTEGER + 1,
        updatedAt,
      }).success,
      false,
    )
    assert.equal(
      categoryUpdateSchema.safeParse({ name: 'Food', monthlyPlanMinor: null, updatedAt }).success,
      false,
    )
    assert.equal(referenceOrderSchema.safeParse({ items: [{ id: 1, updatedAt }] }).success, false)
    assert.equal(referenceOrderSchema.safeParse({
      items: [{ id: 1, updatedAt }, { id: 1, updatedAt }],
    }).success, false)
    assert.equal(referenceOrderSchema.safeParse({
      items: [{ id: 1, updatedAt }, { id: 2, updatedAt, sortOrder: 20 }],
    }).success, false)
  })
})

const valid = {
  id: '019f5087-229b-7ce3-a76f-95c833dcf251',
  type: 'expense',
  amountMinor: 10_050,
  currency: 'HKD',
  accountId: 1,
  categoryId: 2,
  occurredOn: '2026-07-11',
  cleared: false,
  payee: '百佳超級市場',
  note: '',
}

describe('transaction validation', () => {
  it('accepts a complete HKD transaction', () => {
    assert.equal(transactionInputSchema.safeParse(valid).success, true)
    const { cleared, ...withoutClearingStatus } = valid
    assert.equal(cleared, false)
    assert.equal(transactionInputSchema.parse(withoutClearingStatus).cleared, false)
  })

  for (const [label, patch] of [
    ['fractional minor units', { amountMinor: 1.2 }],
    ['unsafe minor units', { amountMinor: Number.MAX_SAFE_INTEGER + 1 }],
    ['non-UUID id', { id: '1' }],
    ['unsupported currency', { currency: 'TWD' }],
    ['date containing a time', { occurredOn: '2026-07-11T10:30:00.000Z' }],
    ['invalid calendar date', { occurredOn: '2026-02-30' }],
    ['oversized payee', { payee: '商'.repeat(81) }],
  ] as const) {
    it(`rejects ${label}`, () => {
      assert.equal(transactionInputSchema.safeParse({ ...valid, ...patch }).success, false)
    })
  }

  it('rejects unknown input fields', () => {
    assert.equal(transactionInputSchema.safeParse({ ...valid, privateMemo: 'nope' }).success, false)
  })

  it('accepts conflict-safe update and delete payloads', () => {
    const { id, ...fields } = valid
    assert.match(id, /-/)
    const updatedAt = '2026-07-11T10:30:00.000Z'
    assert.equal(transactionUpdateSchema.safeParse({ ...fields, updatedAt }).success, true)
    assert.equal(transactionDeleteSchema.safeParse({ updatedAt }).success, true)
  })

  it('accepts only bounded, unique transaction versions for bulk clearing', () => {
    const updatedAt = '2026-07-11T10:30:00.000Z'
    const transactions = [
      { id: valid.id, updatedAt },
      { id: '019f5087-229b-7ce3-a76f-95c833dcf252', updatedAt },
    ]
    assert.deepEqual(transactionClearingBatchSchema.parse({ cleared: true, transactions }), {
      cleared: true,
      transactions,
    })
    assert.equal(transactionClearingBatchSchema.safeParse({ cleared: true, transactions: [] }).success, false)
    assert.equal(transactionClearingBatchSchema.safeParse({
      cleared: false,
      transactions: [transactions[0], transactions[0]],
    }).success, false)
    assert.equal(transactionClearingBatchSchema.safeParse({
      cleared: false,
      transactions: [{ ...transactions[0], updatedAt: 'yesterday' }],
    }).success, false)
    assert.equal(transactionClearingBatchSchema.safeParse({
      cleared: false,
      transactions: [{ ...transactions[0], note: 'not accepted' }],
    }).success, false)
    assert.equal(transactionClearingBatchSchema.safeParse({
      cleared: false,
      transactions: Array.from({ length: 201 }, (_, index) => ({
        id: `30000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        updatedAt,
      })),
    }).success, false)
  })

  it('accepts only a strict target category and unique transaction versions for bulk recategorization', () => {
    const updatedAt = '2026-07-11T10:30:00.000Z'
    const transactions = [
      { id: valid.id, updatedAt },
      { id: '019f5087-229b-7ce3-a76f-95c833dcf252', updatedAt },
    ]

    assert.deepEqual(transactionCategoryBatchSchema.parse({ categoryId: 4, transactions }), {
      categoryId: 4,
      transactions,
    })
    assert.equal(transactionCategoryBatchSchema.safeParse({ categoryId: 0, transactions }).success, false)
    assert.equal(transactionCategoryBatchSchema.safeParse({
      categoryId: 4,
      transactions: [transactions[0], transactions[0]],
    }).success, false)
    assert.equal(transactionCategoryBatchSchema.safeParse({
      categoryId: 4,
      transactions,
      applyToFuture: true,
    }).success, false)
  })

  it('rejects an update that tries to replace its immutable ID', () => {
    const { id, ...fields } = valid
    assert.equal(
      transactionUpdateSchema.safeParse({ ...fields, id, updatedAt: '2026-07-11T10:30:00.000Z' }).success,
      false,
    )
  })

  it('accepts only exact duplicate-check fields and an optional excluded transaction', () => {
    const { id, cleared, ...candidate } = valid
    assert.equal(cleared, false)
    assert.deepEqual(transactionDuplicateCheckSchema.parse(candidate), candidate)
    assert.deepEqual(transactionDuplicateCheckSchema.parse({ ...candidate, excludeId: id }), {
      ...candidate,
      excludeId: id,
    })
    assert.equal(transactionDuplicateCheckSchema.safeParse({ ...candidate, id }).success, false)
    assert.equal(transactionDuplicateCheckSchema.safeParse({ ...candidate, cleared }).success, false)
    assert.equal(transactionDuplicateCheckSchema.safeParse({ ...candidate, privateMemo: 'nope' }).success, false)
    assert.equal(transactionDuplicateCheckSchema.safeParse({ ...candidate, excludeId: '1' }).success, false)
  })
})

describe('transaction query validation', () => {
  it('accepts filters plus a strict transaction order', () => {
    assert.deepEqual(
      transactionQuerySchema.parse({
        month: '2026-07',
        scope: 'all',
        type: 'expense',
        status: 'uncleared',
        accountId: '2',
        categoryId: '3',
        search: '超級市場',
        tag: '旅程',
        duplicates: 'exact',
        sort: 'amount_desc',
      }),
      {
        month: '2026-07',
        scope: 'all',
        type: 'expense',
        status: 'uncleared',
        accountId: 2,
        categoryId: 3,
        search: '超級市場',
        tag: '旅程',
        duplicates: 'exact',
        sort: 'amount_desc',
      },
    )
    assert.equal(transactionQuerySchema.parse({ month: '2026-07' }).scope, 'month')
  })

  it('accepts only complete, ordered custom date ranges', () => {
    assert.deepEqual(transactionQuerySchema.parse({
      month: '2026-07',
      scope: 'range',
      dateFrom: '2025-04-01',
      dateTo: '2026-03-31',
    }), {
      month: '2026-07',
      scope: 'range',
      dateFrom: '2025-04-01',
      dateTo: '2026-03-31',
    })

    for (const query of [
      { month: '2026-07', scope: 'range', dateFrom: '2026-07-01' },
      { month: '2026-07', scope: 'range', dateTo: '2026-07-31' },
      { month: '2026-07', scope: 'range', dateFrom: '2026-08-01', dateTo: '2026-07-31' },
      { month: '2026-07', scope: 'range', dateFrom: '2026-02-30', dateTo: '2026-03-01' },
      { month: '2026-07', scope: 'month', dateFrom: '2026-07-01', dateTo: '2026-07-31' },
      { month: '2026-07', scope: 'all', dateFrom: '2026-07-01', dateTo: '2026-07-31' },
    ] as const) {
      assert.equal(transactionQuerySchema.safeParse(query).success, false)
    }
  })

  for (const [index, query] of [
    { month: '2026-13' },
    { type: 'transfer' },
    { month: '2026-07', status: 'pending' },
    { accountId: '0' },
    { categoryId: '1.5' },
    { search: 'x'.repeat(81) },
    { tag: 'trip,' },
    { tag: '#trip' },
    { month: '2026-07', duplicates: 'fuzzy' },
    { month: '2026-07', sort: 'amount; DROP TABLE transactions' },
    { month: '2026-07', scope: 'year' },
  ].entries()) {
    it(`rejects invalid query ${index}`, () => {
      assert.equal(transactionQuerySchema.safeParse(query).success, false)
    })
  }
})

describe('account transfer validation', () => {
  const transfer = {
    id: '019f5087-229b-7ce3-a76f-95c833dcf253',
    amountMinor: 50_000,
    currency: 'HKD',
    fromAccountId: 1,
    toAccountId: 2,
    occurredOn: '2026-07-11',
    fromCleared: true,
    toCleared: false,
    note: 'Cash withdrawal',
  } as const

  it('accepts an exact two-sided HKD transfer', () => {
    assert.deepEqual(accountTransferInputSchema.parse(transfer), transfer)
  })

  it('rejects self-transfers, unsafe amounts, dates with times, and extra fields', () => {
    assert.equal(accountTransferInputSchema.safeParse({ ...transfer, toAccountId: 1 }).success, false)
    assert.equal(accountTransferInputSchema.safeParse({
      ...transfer,
      amountMinor: Number.MAX_SAFE_INTEGER + 1,
    }).success, false)
    assert.equal(accountTransferInputSchema.safeParse({
      ...transfer,
      occurredOn: '2026-07-11T10:30:00.000Z',
    }).success, false)
    assert.equal(accountTransferInputSchema.safeParse({ ...transfer, categoryId: 3 }).success, false)
  })

  it('uses a conflict token without allowing an ID replacement', () => {
    const { id, ...fields } = transfer
    const updatedAt = '2026-07-11T10:30:00.000Z'
    assert.equal(accountTransferUpdateSchema.safeParse({ ...fields, updatedAt }).success, true)
    assert.equal(accountTransferUpdateSchema.safeParse({ ...fields, id, updatedAt }).success, false)
    const { toCleared: _toCleared, ...missingPostingState } = fields
    assert.equal(_toCleared, false)
    assert.equal(accountTransferUpdateSchema.safeParse({ ...missingPostingState, updatedAt }).success, false)
  })

  it('requires one strict calendar month query', () => {
    assert.deepEqual(accountTransferQuerySchema.parse({ month: '2026-07' }), { month: '2026-07' })
    assert.deepEqual(accountTransferQuerySchema.parse({ month: '2026-07', accountId: '2' }), {
      month: '2026-07',
      accountId: 2,
    })
    assert.equal(accountTransferQuerySchema.safeParse({ month: '2026-13' }).success, false)
    assert.equal(accountTransferQuerySchema.safeParse({ month: '2026-07', accountId: '0' }).success, false)
    assert.equal(accountTransferQuerySchema.safeParse({ month: '2026-07', other: '1' }).success, false)
  })
})

const validRecurringRule = {
  id: '019f5087-229b-7ce3-a76f-95c833dcf252',
  name: '家居租金',
  type: 'expense',
  amountMinor: 1_200_000,
  currency: 'HKD',
  accountId: 2,
  categoryId: 6,
  frequency: 'monthly',
  scheduleStartsOn: '2026-08-01',
  isActive: true,
  payee: '業主',
  note: '',
}

describe('recurring rule validation', () => {
  it('accepts create, update, status, skip, and delete payloads', () => {
    assert.equal(recurringRuleCreateSchema.safeParse(validRecurringRule).success, true)
    assert.equal(recurringRuleCreateSchema.safeParse({
      ...validRecurringRule,
      firstOccurrenceOn: '2026-09-01',
    }).success, true)
    const { id, ...update } = validRecurringRule
    assert.match(id, /-/)
    assert.equal(recurringRuleUpdateSchema.safeParse({ ...update, revision: 1 }).success, true)
    assert.equal(recurringRuleStatusSchema.safeParse({ isActive: false, revision: 1 }).success, true)
    assert.equal(recurringRuleSkipSchema.safeParse({
      revision: 1,
      nextOccurrenceOn: '2026-08-01',
    }).success, true)
    assert.equal(recurringRuleDeleteSchema.safeParse({ revision: 1 }).success, true)
    assert.equal(recurringRuleSkipSchema.safeParse({
      revision: 1,
      nextOccurrenceOn: '2026-02-30',
    }).success, false)
    assert.equal(recurringRuleSkipSchema.safeParse({
      revision: 1,
      nextOccurrenceOn: '2026-08-01',
      extra: true,
    }).success, false)
  })

  for (const [label, patch] of [
    ['unsupported frequency', { frequency: 'yearly' }],
    ['invalid start date', { scheduleStartsOn: '2026-02-30' }],
    ['first occurrence before the anchor date', { firstOccurrenceOn: '2026-07-31' }],
    ['empty rule name', { name: '   ' }],
    ['fractional amount', { amountMinor: 1.5 }],
    ['unknown field', { privateInstruction: 'nope' }],
  ] as const) {
    it(`rejects ${label}`, () => {
      assert.equal(recurringRuleCreateSchema.safeParse({ ...validRecurringRule, ...patch }).success, false)
    })
  }
})
