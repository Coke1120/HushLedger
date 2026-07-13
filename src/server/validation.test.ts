import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { accountRegisterQuerySchema } from './validation'

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
