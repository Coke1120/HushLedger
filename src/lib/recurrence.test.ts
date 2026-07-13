import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  advanceOccurrence,
  dueOccurrences,
  firstOccurrenceOnOrAfter,
  recurrenceAnchorDay,
  recurringGenerationNeedsAttention,
} from './recurrence'

describe('recurring transaction dates', () => {
  it('advances daily and weekly dates across a year boundary', () => {
    assert.equal(advanceOccurrence('2026-12-31', 'daily'), '2027-01-01')
    assert.equal(advanceOccurrence('2026-12-28', 'weekly'), '2027-01-04')
  })

  it('clamps a monthly 31st anchor and returns to the original day', () => {
    const anchor = recurrenceAnchorDay('2026-01-31')
    const february = advanceOccurrence('2026-01-31', 'monthly', anchor)
    const march = advanceOccurrence(february, 'monthly', anchor)
    assert.equal(february, '2026-02-28')
    assert.equal(march, '2026-03-31')
  })

  it('handles leap-year month ends without losing the anchor', () => {
    const anchor = recurrenceAnchorDay('2024-01-30')
    assert.equal(advanceOccurrence('2024-01-30', 'monthly', anchor), '2024-02-29')
    assert.equal(advanceOccurrence('2024-02-29', 'monthly', anchor), '2024-03-30')
  })

  it('clamps a leap-day yearly anchor and restores it in the next leap year', () => {
    const anchor = recurrenceAnchorDay('2024-02-29')
    const first = advanceOccurrence('2024-02-29', 'yearly', anchor)
    const second = advanceOccurrence(first, 'yearly', anchor)
    const third = advanceOccurrence(second, 'yearly', anchor)
    const fourth = advanceOccurrence(third, 'yearly', anchor)

    assert.deepEqual([first, second, third, fourth], [
      '2025-02-28',
      '2026-02-28',
      '2027-02-28',
      '2028-02-29',
    ])
    assert.equal(firstOccurrenceOnOrAfter('2024-02-29', '2027-03-01', 'yearly', anchor), '2028-02-29')
  })

  it('collects missed occurrences oldest-first and is retry-friendly', () => {
    assert.deepEqual(dueOccurrences('2026-07-01', '2026-07-03', 'daily', 1), {
      occurrences: ['2026-07-01', '2026-07-02', '2026-07-03'],
      nextOccurrenceOn: '2026-07-04',
      truncated: false,
    })
  })

  it('keeps the first unprocessed yearly date when the safety cap is reached', () => {
    assert.deepEqual(dueOccurrences('2024-02-29', '2028-02-29', 'yearly', 29, 3), {
      occurrences: ['2024-02-29', '2025-02-28', '2026-02-28'],
      nextOccurrenceOn: '2027-02-28',
      truncated: true,
    })
  })

  it('leaves the first unprocessed date when the safety cap is reached', () => {
    assert.deepEqual(dueOccurrences('2026-07-01', '2026-07-05', 'daily', 1, 2), {
      occurrences: ['2026-07-01', '2026-07-02'],
      nextOccurrenceOn: '2026-07-03',
      truncated: true,
    })
  })

  it('requires attention when any due-rule work remains incomplete', () => {
    assert.equal(recurringGenerationNeedsAttention({ blocked: 0, truncated: 0, failed: 0 }), false)
    for (const field of ['blocked', 'truncated', 'failed'] as const) {
      assert.equal(recurringGenerationNeedsAttention({
        blocked: 0,
        truncated: 0,
        failed: 0,
        [field]: 1,
      }), true)
    }
  })

  it('skips paused dates when resuming', () => {
    assert.equal(firstOccurrenceOnOrAfter('2026-07-01', '2026-07-11', 'weekly', 1), '2026-07-15')
  })

  it('fast-forwards long-running daily and weekly schedules without an iteration cap', () => {
    assert.equal(firstOccurrenceOnOrAfter('1970-01-01', '2026-07-11', 'daily', 1), '2026-07-11')
    assert.equal(firstOccurrenceOnOrAfter('1970-01-01', '2026-07-11', 'weekly', 1), '2026-07-16')
  })

  it('fast-forwards monthly schedules while preserving the original month-end anchor', () => {
    assert.equal(firstOccurrenceOnOrAfter('1970-01-31', '2026-02-01', 'monthly', 31), '2026-02-28')
    assert.equal(firstOccurrenceOnOrAfter('1970-01-31', '2026-03-01', 'monthly', 31), '2026-03-31')
  })

  it('fast-forwards yearly schedules without changing the original month', () => {
    assert.equal(firstOccurrenceOnOrAfter('1972-02-29', '2026-02-01', 'yearly', 29), '2026-02-28')
    assert.equal(firstOccurrenceOnOrAfter('1972-02-29', '2026-03-01', 'yearly', 29), '2027-02-28')
  })

  it('uses Gregorian leap-year rules across century boundaries', () => {
    assert.equal(firstOccurrenceOnOrAfter('2096-02-29', '2100-02-01', 'yearly', 29), '2100-02-28')
    assert.equal(firstOccurrenceOnOrAfter('2096-02-29', '2104-02-01', 'yearly', 29), '2104-02-29')
  })

  it('rejects invalid calendar input', () => {
    assert.throws(() => advanceOccurrence('2026-02-30', 'daily'))
  })
})
