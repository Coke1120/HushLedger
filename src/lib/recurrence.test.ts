import { describe, expect, it } from 'vitest'
import {
  advanceOccurrence,
  dueOccurrences,
  firstOccurrenceOnOrAfter,
  recurrenceAnchorDay,
} from './recurrence'

describe('recurring transaction dates', () => {
  it('advances daily and weekly dates across a year boundary', () => {
    expect(advanceOccurrence('2026-12-31', 'daily')).toBe('2027-01-01')
    expect(advanceOccurrence('2026-12-28', 'weekly')).toBe('2027-01-04')
  })

  it('clamps a monthly 31st anchor and returns to the original day', () => {
    const anchor = recurrenceAnchorDay('2026-01-31')
    const february = advanceOccurrence('2026-01-31', 'monthly', anchor)
    const march = advanceOccurrence(february, 'monthly', anchor)
    expect(february).toBe('2026-02-28')
    expect(march).toBe('2026-03-31')
  })

  it('handles leap-year month ends without losing the anchor', () => {
    const anchor = recurrenceAnchorDay('2024-01-30')
    expect(advanceOccurrence('2024-01-30', 'monthly', anchor)).toBe('2024-02-29')
    expect(advanceOccurrence('2024-02-29', 'monthly', anchor)).toBe('2024-03-30')
  })

  it('collects missed occurrences oldest-first and is retry-friendly', () => {
    expect(dueOccurrences('2026-07-01', '2026-07-03', 'daily', 1)).toEqual({
      occurrences: ['2026-07-01', '2026-07-02', '2026-07-03'],
      nextOccurrenceOn: '2026-07-04',
      truncated: false,
    })
  })

  it('leaves the first unprocessed date when the safety cap is reached', () => {
    expect(dueOccurrences('2026-07-01', '2026-07-05', 'daily', 1, 2)).toEqual({
      occurrences: ['2026-07-01', '2026-07-02'],
      nextOccurrenceOn: '2026-07-03',
      truncated: true,
    })
  })

  it('skips paused dates when resuming', () => {
    expect(firstOccurrenceOnOrAfter('2026-07-01', '2026-07-11', 'weekly', 1)).toBe('2026-07-15')
  })

  it('fast-forwards long-running daily and weekly schedules without an iteration cap', () => {
    expect(firstOccurrenceOnOrAfter('1970-01-01', '2026-07-11', 'daily', 1)).toBe('2026-07-11')
    expect(firstOccurrenceOnOrAfter('1970-01-01', '2026-07-11', 'weekly', 1)).toBe('2026-07-16')
  })

  it('fast-forwards monthly schedules while preserving the original month-end anchor', () => {
    expect(firstOccurrenceOnOrAfter('1970-01-31', '2026-02-01', 'monthly', 31)).toBe('2026-02-28')
    expect(firstOccurrenceOnOrAfter('1970-01-31', '2026-03-01', 'monthly', 31)).toBe('2026-03-31')
  })

  it('rejects invalid calendar input', () => {
    expect(() => advanceOccurrence('2026-02-30', 'daily')).toThrow()
  })
})
