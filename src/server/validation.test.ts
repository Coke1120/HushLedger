import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  accountRegisterClearingSchema,
  accountRegisterQuerySchema,
  accountUnclearedReviewSchema,
} from './validation'

describe('account register query validation', () => {
  it('preserves the strict calendar-month query for older app shells', () => {
    assert.deepEqual(accountRegisterQuerySchema.parse({
      month: '2026-07',
      accountId: '2',
    }), {
      month: '2026-07',
      accountId: 2,
    })
  })

  it('accepts complete inclusive statement ranges, including a single leap day', () => {
    assert.deepEqual(accountRegisterQuerySchema.parse({
      dateFrom: '2026-06-13',
      dateTo: '2026-07-12',
      accountId: '2',
    }), {
      dateFrom: '2026-06-13',
      dateTo: '2026-07-12',
      accountId: 2,
    })
    assert.equal(accountRegisterQuerySchema.safeParse({
      dateFrom: '2024-02-29',
      dateTo: '2024-02-29',
      accountId: 2,
    }).success, true)
  })

  for (const [name, query] of Object.entries({
    'missing start': { dateTo: '2026-07-12', accountId: 2 },
    'missing end': { dateFrom: '2026-06-13', accountId: 2 },
    reversed: { dateFrom: '2026-07-13', dateTo: '2026-07-12', accountId: 2 },
    'invalid date': { dateFrom: '2026-02-29', dateTo: '2026-03-01', accountId: 2 },
    'mixed month and range': {
      month: '2026-07',
      dateFrom: '2026-06-13',
      dateTo: '2026-07-12',
      accountId: 2,
    },
    'invalid account': { month: '2026-07', accountId: 0 },
    extra: { month: '2026-07', accountId: 2, privateMemo: 'never accept' },
  })) {
    it(`rejects ${name}`, () => {
      assert.equal(accountRegisterQuerySchema.safeParse(query).success, false)
    })
  }
})

describe('complete uncleared account review validation', () => {
  it('accepts only an explicit account and inclusive cutoff date', () => {
    assert.deepEqual(accountUnclearedReviewSchema.parse({
      accountId: 2,
      dateTo: '2024-02-29',
    }), {
      accountId: 2,
      dateTo: '2024-02-29',
    })
  })

  for (const input of [
    { accountId: '2', dateTo: '2026-07-12' },
    { accountId: 2, dateTo: '2026-02-29' },
    { accountId: 2, dateTo: '2026-07-12', dateFrom: '2026-01-01' },
  ]) {
    it(`rejects ${JSON.stringify(input)}`, () => {
      assert.equal(accountUnclearedReviewSchema.safeParse(input).success, false)
    })
  }
})

describe('account register clearing validation', () => {
  const valid = {
    accountId: 2,
    kind: 'transfer',
    sourceId: '10000000-0000-4000-8000-000000000001',
    updatedAt: '2026-07-12T08:30:00.000Z',
    cleared: true,
  }

  it('accepts a narrow optimistic clearing update', () => {
    assert.deepEqual(accountRegisterClearingSchema.parse(valid), valid)
  })

  for (const patch of [
    { accountId: 0 },
    { kind: 'opening' },
    { sourceId: 'not-an-id' },
    { updatedAt: 'yesterday' },
    { cleared: 1 },
    { privateMemo: 'never accept' },
  ]) {
    it(`rejects ${JSON.stringify(patch)}`, () => {
      assert.equal(accountRegisterClearingSchema.safeParse({ ...valid, ...patch }).success, false)
    })
  }
})
