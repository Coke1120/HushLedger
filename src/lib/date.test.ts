import { describe, expect, it } from 'vitest'
import {
  currentHongKongDate,
  formatHongKongDate,
  isValidCalendarDate,
  monthRangeDates,
  shiftMonth,
} from './date'

describe('Hong Kong date helpers', () => {
  it('builds date-only boundaries for a calendar month', () => {
    expect(monthRangeDates('2026-07')).toEqual({
      start: '2026-07-01',
      end: '2026-08-01',
    })
  })

  it('derives today from the Hong Kong calendar without exposing a time field', () => {
    expect(currentHongKongDate(new Date('2026-06-30T16:30:00.000Z'))).toEqual({
      date: '2026-07-01',
      month: '2026-07',
    })
  })

  it('moves across year boundaries', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
  })

  it.each([
    ['2024-02-29', true],
    ['2026-02-29', false],
    ['2026-02-30', false],
    ['11-07-2026', false],
  ])('validates calendar date %s', (date, expected) => {
    expect(isValidCalendarDate(date)).toBe(expected)
  })

  it('formats a transaction date without a time', () => {
    expect(formatHongKongDate('2026-07-11')).toBe('7月11日')
  })

  it('rejects an invalid month query', () => {
    expect(() => monthRangeDates('2026-13')).toThrow()
  })
})
