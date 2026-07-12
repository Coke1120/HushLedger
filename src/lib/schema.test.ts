import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  recurringRuleCreateSchema,
  recurringRuleDeleteSchema,
  recurringRuleStatusSchema,
  recurringRuleUpdateSchema,
  transactionInputSchema,
  transactionQuerySchema,
} from './schema'

const valid = {
  id: '019f5087-229b-7ce3-a76f-95c833dcf251',
  type: 'expense',
  amountMinor: 10_050,
  currency: 'HKD',
  accountId: 1,
  categoryId: 2,
  occurredOn: '2026-07-11',
  payee: '百佳超級市場',
  note: '',
}

describe('transaction validation', () => {
  it('accepts a complete HKD transaction', () => {
    assert.equal(transactionInputSchema.safeParse(valid).success, true)
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
})

describe('transaction query validation', () => {
  it('accepts month, type, and a bounded search string', () => {
    assert.deepEqual(
      transactionQuerySchema.parse({ month: '2026-07', type: 'expense', search: '超級市場' }),
      { month: '2026-07', type: 'expense', search: '超級市場' },
    )
  })

  for (const [index, query] of [
    { month: '2026-13' },
    { type: 'transfer' },
    { search: 'x'.repeat(81) },
  ].entries()) {
    it(`rejects invalid query ${index}`, () => {
      assert.equal(transactionQuerySchema.safeParse(query).success, false)
    })
  }
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
  it('accepts create, update, and status payloads', () => {
    assert.equal(recurringRuleCreateSchema.safeParse(validRecurringRule).success, true)
    const { id, ...update } = validRecurringRule
    assert.match(id, /-/)
    assert.equal(recurringRuleUpdateSchema.safeParse({ ...update, revision: 1 }).success, true)
    assert.equal(recurringRuleStatusSchema.safeParse({ isActive: false, revision: 1 }).success, true)
    assert.equal(recurringRuleDeleteSchema.safeParse({ revision: 1 }).success, true)
  })

  for (const [label, patch] of [
    ['unsupported frequency', { frequency: 'yearly' }],
    ['invalid start date', { scheduleStartsOn: '2026-02-30' }],
    ['empty rule name', { name: '   ' }],
    ['fractional amount', { amountMinor: 1.5 }],
    ['unknown field', { privateInstruction: 'nope' }],
  ] as const) {
    it(`rejects ${label}`, () => {
      assert.equal(recurringRuleCreateSchema.safeParse({ ...validRecurringRule, ...patch }).success, false)
    })
  }
})
