import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  currentHongKongDate,
  formatHongKongDate,
  formatHongKongDateWithYear,
  inclusiveMonthRangeDates,
  isValidCalendarDate,
  millisecondsUntilNextHongKongDay,
  monthRangeDates,
  shiftMonth,
  trailingSevenDayRange,
  trailingTwelveMonthRange,
} from './date'

describe('Hong Kong date helpers', () => {
  it('builds date-only boundaries for a calendar month', () => {
    assert.deepEqual(monthRangeDates('2026-07'), {
      start: '2026-07-01',
      end: '2026-08-01',
    })
  })

  it('builds inclusive calendar-month boundaries without timezone arithmetic', () => {
    assert.deepEqual(inclusiveMonthRangeDates('2026-07'), {
      start: '2026-07-01',
      end: '2026-07-31',
    })
    assert.deepEqual(inclusiveMonthRangeDates('2024-02'), {
      start: '2024-02-01',
      end: '2024-02-29',
    })
  })

  it('derives today from the Hong Kong calendar without exposing a time field', () => {
    assert.deepEqual(currentHongKongDate(new Date('2026-06-30T16:30:00.000Z')), {
      date: '2026-07-01',
      month: '2026-07',
    })
  })

  it('schedules a refresh at the next Hong Kong calendar-day boundary', () => {
    assert.equal(
      millisecondsUntilNextHongKongDay(new Date('2026-07-14T15:59:59.500Z')),
      500,
    )
    assert.equal(
      millisecondsUntilNextHongKongDay(new Date('2026-12-31T16:00:00.000Z')),
      24 * 60 * 60 * 1000,
    )
  })

  it('moves across year boundaries', () => {
    assert.equal(shiftMonth('2026-01', -1), '2025-12')
    assert.equal(shiftMonth('2026-12', 1), '2027-01')
  })

  it('builds twelve complete calendar months ending at the selected month', () => {
    assert.deepEqual(trailingTwelveMonthRange('2026-07'), {
      start: '2025-08-01',
      end: '2026-07-31',
    })
    assert.deepEqual(trailingTwelveMonthRange('2024-02'), {
      start: '2023-03-01',
      end: '2024-02-29',
    })
  })

  it('builds seven inclusive calendar dates ending at the supplied Hong Kong date', () => {
    assert.deepEqual(trailingSevenDayRange('2026-07-13'), {
      start: '2026-07-07',
      end: '2026-07-13',
    })
    assert.deepEqual(trailingSevenDayRange('2026-01-03'), {
      start: '2025-12-28',
      end: '2026-01-03',
    })
    assert.deepEqual(trailingSevenDayRange('2024-03-02'), {
      start: '2024-02-25',
      end: '2024-03-02',
    })
  })

  it('rejects an invalid trailing-seven-day boundary', () => {
    assert.throws(() => trailingSevenDayRange('2026-02-29'), /YYYY-MM-DD/)
  })

  for (const [date, expected] of [
    ['2024-02-29', true],
    ['2026-02-29', false],
    ['2026-02-30', false],
    ['11-07-2026', false],
  ] as const) {
    it(`validates calendar date ${date}`, () => {
      assert.equal(isValidCalendarDate(date), expected)
    })
  }

  it('formats a transaction date without a time', () => {
    assert.equal(formatHongKongDate('2026-07-11'), '7月11日')
    assert.equal(formatHongKongDate('2026-07-11', 'en'), 'July 11')
    assert.equal(formatHongKongDate('2026-07-11', 'ja'), '7月11日')
    assert.equal(formatHongKongDate('2026-07-11', 'fr'), '11 juillet')
  })

  it('keeps an absolute range date unambiguous across years', () => {
    assert.equal(formatHongKongDateWithYear('2026-12-15', 'en'), 'December 15, 2026')
    assert.equal(formatHongKongDateWithYear('2027-01-18', 'en'), 'January 18, 2027')
    assert.equal(formatHongKongDateWithYear('2027-01-18', 'zh-Hant'), '2027年1月18日')
  })

  it('rejects an invalid month query', () => {
    assert.throws(() => monthRangeDates('2026-13'))
  })
})
