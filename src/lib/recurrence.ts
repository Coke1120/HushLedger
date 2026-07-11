import { isValidCalendarDate } from './date'

export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly'

const DAY_MS = 24 * 60 * 60 * 1000

function parseDate(value: string) {
  if (!isValidCalendarDate(value)) throw new Error('週期日期必須是有效的 YYYY-MM-DD')
  const [year, month, day] = value.split('-').map(Number)
  return { year, month, day }
}

function formatUtcDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function assertAnchorDay(anchorDay: number) {
  if (!Number.isInteger(anchorDay) || anchorDay < 1 || anchorDay > 31) {
    throw new Error('每月週期日必須介乎 1 至 31')
  }
}

function utcDayNumber(value: { year: number; month: number; day: number }) {
  return Math.floor(Date.UTC(value.year, value.month - 1, value.day) / DAY_MS)
}

function monthlyOccurrence(
  start: { year: number; month: number },
  monthOffset: number,
  anchorDay: number,
) {
  const monthIndex = start.month - 1 + monthOffset
  const year = start.year + Math.floor(monthIndex / 12)
  const normalizedMonthIndex = ((monthIndex % 12) + 12) % 12
  const day = Math.min(anchorDay, daysInMonth(year, normalizedMonthIndex + 1))
  return formatUtcDate(new Date(Date.UTC(year, normalizedMonthIndex, day)))
}

export function recurrenceAnchorDay(startOn: string) {
  return parseDate(startOn).day
}

export function advanceOccurrence(
  occurredOn: string,
  frequency: RecurrenceFrequency,
  anchorDay = recurrenceAnchorDay(occurredOn),
) {
  const { year, month, day } = parseDate(occurredOn)
  assertAnchorDay(anchorDay)

  if (frequency === 'daily' || frequency === 'weekly') {
    const interval = frequency === 'daily' ? 1 : 7
    return formatUtcDate(new Date(Date.UTC(year, month - 1, day) + interval * DAY_MS))
  }

  return monthlyOccurrence({ year, month }, 1, anchorDay)
}

export function dueOccurrences(
  nextOccurrenceOn: string,
  asOf: string,
  frequency: RecurrenceFrequency,
  anchorDay: number,
  limit = 366,
) {
  parseDate(nextOccurrenceOn)
  parseDate(asOf)
  if (!Number.isInteger(limit) || limit < 1) throw new Error('週期產生上限必須是正整數')

  const occurrences: string[] = []
  let next = nextOccurrenceOn
  while (next <= asOf && occurrences.length < limit) {
    occurrences.push(next)
    next = advanceOccurrence(next, frequency, anchorDay)
  }

  return {
    occurrences,
    nextOccurrenceOn: next,
    truncated: next <= asOf,
  }
}

export function firstOccurrenceOnOrAfter(
  nextOccurrenceOn: string,
  minimumDate: string,
  frequency: RecurrenceFrequency,
  anchorDay: number,
) {
  const start = parseDate(nextOccurrenceOn)
  const minimum = parseDate(minimumDate)
  assertAnchorDay(anchorDay)
  if (nextOccurrenceOn >= minimumDate) return nextOccurrenceOn

  if (frequency === 'daily' || frequency === 'weekly') {
    const intervalDays = frequency === 'daily' ? 1 : 7
    const elapsedDays = utcDayNumber(minimum) - utcDayNumber(start)
    const intervals = Math.ceil(elapsedDays / intervalDays)
    return formatUtcDate(
      new Date(Date.UTC(start.year, start.month - 1, start.day) + intervals * intervalDays * DAY_MS),
    )
  }

  let monthOffset = (minimum.year - start.year) * 12 + minimum.month - start.month
  let candidate = monthlyOccurrence(start, monthOffset, anchorDay)
  if (candidate < minimumDate) {
    monthOffset += 1
    candidate = monthlyOccurrence(start, monthOffset, anchorDay)
  }
  return candidate
}
