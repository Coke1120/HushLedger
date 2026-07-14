import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getRecurringAmountReview } from './recurringAmountReview'

describe('recurring amount review', () => {
  const rule = {
    amountMinor: 1_500,
    latestGeneratedAmountMinor: 1_200,
    latestGeneratedDueOn: '2026-07-14',
  }

  it('returns a neutral comparison for a safe differing generated amount', () => {
    assert.deepEqual(getRecurringAmountReview(rule), {
      latestGeneratedAmountMinor: 1_200,
      latestGeneratedDueOn: '2026-07-14',
      futureAmountMinor: 1_500,
    })
  })

  it('ignores absent, equal, or unsafe generated metadata', () => {
    assert.equal(getRecurringAmountReview({ amountMinor: 1_500 }), null)
    assert.equal(getRecurringAmountReview({ ...rule, latestGeneratedAmountMinor: null }), null)
    assert.equal(getRecurringAmountReview({ ...rule, latestGeneratedAmountMinor: 1_500 }), null)
    assert.equal(getRecurringAmountReview({ ...rule, latestGeneratedAmountMinor: Number.MAX_SAFE_INTEGER + 1 }), null)
    assert.equal(getRecurringAmountReview({ ...rule, latestGeneratedDueOn: '2026-02-30' }), null)
  })
})
