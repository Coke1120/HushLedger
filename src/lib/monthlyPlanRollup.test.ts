import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { summarizeMonthlyPlans } from './monthlyPlanRollup'

describe('monthly plan roll-up', () => {
  it('includes every plan and separates expenses recorded outside planned categories', () => {
    assert.deepEqual(summarizeMonthlyPlans(48_000, [
      { plannedMinor: 30_000, spentMinor: 22_000 },
      { plannedMinor: 15_000, spentMinor: 18_000 },
      { plannedMinor: 5_000, spentMinor: 0 },
    ]), {
      plannedMinor: 50_000,
      spentInPlansMinor: 40_000,
      differenceMinor: 10_000,
      outsidePlansMinor: 8_000,
    })
  })

  it('preserves a combined over-plan result without treating it as cash availability', () => {
    assert.deepEqual(summarizeMonthlyPlans(41_000, [
      { plannedMinor: 20_000, spentMinor: 24_000 },
      { plannedMinor: 10_000, spentMinor: 12_000 },
    ]), {
      plannedMinor: 30_000,
      spentInPlansMinor: 36_000,
      differenceMinor: -6_000,
      outsidePlansMinor: 5_000,
    })
  })

  it('withholds inconsistent or inexact aggregates instead of crashing the overview', () => {
    assert.equal(summarizeMonthlyPlans(100, [{ plannedMinor: 100, spentMinor: 101 }]), null)
    assert.equal(summarizeMonthlyPlans(Number.MAX_SAFE_INTEGER, [
      { plannedMinor: Number.MAX_SAFE_INTEGER, spentMinor: 0 },
      { plannedMinor: 1, spentMinor: 0 },
    ]), null)
    assert.equal(summarizeMonthlyPlans(-1, []), null)
  })
})
