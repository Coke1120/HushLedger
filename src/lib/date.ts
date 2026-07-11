const HONG_KONG_TIME_ZONE = 'Asia/Hong_Kong'
const monthPattern = /^(\d{4})-(\d{2})$/
const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/

function parseMonth(month: string) {
  const match = monthPattern.exec(month)
  if (!match) throw new Error('月份格式必須為 YYYY-MM')
  const year = Number(match[1])
  const monthIndex = Number(match[2]) - 1
  if (monthIndex < 0 || monthIndex > 11) throw new Error('月份不正確')
  return { year, monthIndex }
}

export function monthRangeDates(month: string) {
  const { year, monthIndex } = parseMonth(month)
  const nextMonth = new Date(Date.UTC(year, monthIndex + 1, 1))
  return {
    start: `${month}-01`,
    end: `${nextMonth.getUTCFullYear()}-${String(nextMonth.getUTCMonth() + 1).padStart(2, '0')}-01`,
  }
}

export function shiftMonth(month: string, amount: number) {
  const { year, monthIndex } = parseMonth(month)
  const shifted = new Date(Date.UTC(year, monthIndex + amount, 1))
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`
}

export function isValidCalendarDate(value: string) {
  if (!datePattern.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function partsFor(date: Date) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: HONG_KONG_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]))
}

export function currentHongKongDate(now = new Date()) {
  const parts = partsFor(now)
  const date = `${parts.year}-${parts.month}-${parts.day}`
  return {
    date,
    month: date.slice(0, 7),
  }
}

export function formatMonthLabel(month: string) {
  const { year, monthIndex } = parseMonth(month)
  return new Intl.DateTimeFormat('zh-HK', {
    year: 'numeric',
    month: 'long',
    timeZone: HONG_KONG_TIME_ZONE,
  }).format(new Date(Date.UTC(year, monthIndex, 15)))
}

export function formatHongKongDate(value: string) {
  if (!isValidCalendarDate(value)) throw new Error('交易日期必須是有效的 YYYY-MM-DD')
  return new Intl.DateTimeFormat('zh-HK', {
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00.000Z`))
}
