import { isValidCalendarDate } from './date'
import type { AccountUnclearedReview, AccountUnclearedReviewEntry } from './schema'

type ReviewContext = {
  accountId: number
  dateTo: string
}

type ReviewSelectionContext = ReviewContext & {
  dateFrom: string
  draftDateFrom: string
  draftDateTo: string
  available: boolean
  snapshotVersion: number
}

type CurrentReviewRequest = {
  requestId: number
  activeRequestId: number
  requestContext: string
  activeContext: string
  aborted: boolean
}

export function accountUnclearedReviewContext({
  accountId,
  dateFrom,
  dateTo,
  draftDateFrom,
  draftDateTo,
  available,
  snapshotVersion,
}: ReviewSelectionContext) {
  return JSON.stringify([
    accountId,
    dateFrom,
    dateTo,
    draftDateFrom,
    draftDateTo,
    available,
    snapshotVersion,
  ])
}

export function accountUnclearedReviewIsCurrent({
  requestId,
  activeRequestId,
  requestContext,
  activeContext,
  aborted,
}: CurrentReviewRequest) {
  return !aborted
    && requestId === activeRequestId
    && requestContext === activeContext
}

export function parseAccountUnclearedReview(
  value: unknown,
  context: ReviewContext,
): AccountUnclearedReview | null {
  if (!isRecord(value)
    || value.complete !== true
    || value.accountId !== context.accountId
    || value.dateTo !== context.dateTo
    || !Number.isSafeInteger(value.accountId)
    || (value.accountId as number) <= 0
    || !isValidCalendarDate(value.dateTo)
    || typeof value.accountName !== 'string'
    || !isNullableString(value.accountLocalizationKey)
    || !isNullableCalendarDate(value.availableFrom)
    || !isNullableSafeInteger(value.endingBalanceMinor)
    || !isNullableSafeInteger(value.clearedEndingBalanceMinor)
    || !isNullableSafeInteger(value.unclearedEndingBalanceMinor)
    || !Number.isSafeInteger(value.unclearedCount)
    || (value.unclearedCount as number) < 0
    || !Array.isArray(value.entries)
    || value.entries.length !== value.unclearedCount) return null

  const balances = [
    value.endingBalanceMinor,
    value.clearedEndingBalanceMinor,
    value.unclearedEndingBalanceMinor,
  ]
  const balancesUnavailable = balances.every((balance) => balance === null)
  const balancesAvailable = balances.every((balance) => Number.isSafeInteger(balance))
  if ((!balancesUnavailable && !balancesAvailable)
    || (balancesUnavailable && value.unclearedCount !== 0)
    || (balancesAvailable
      && BigInt(value.endingBalanceMinor as number)
        - BigInt(value.clearedEndingBalanceMinor as number)
        !== BigInt(value.unclearedEndingBalanceMinor as number))) return null

  const entries: AccountUnclearedReviewEntry[] = []
  const entryIds = new Set<string>()
  const sourceIds = new Set<string>()
  for (const entry of value.entries) {
    const sourceKey = isRecord(entry) ? `${String(entry.kind)}:${String(entry.sourceId)}` : ''
    if (!isAccountUnclearedReviewEntry(entry, context.dateTo)
      || entryIds.has(entry.entryId)
      || sourceIds.has(sourceKey)) return null
    entryIds.add(entry.entryId)
    sourceIds.add(sourceKey)
    entries.push(entry)
  }

  return { ...value, entries } as AccountUnclearedReview
}

function isAccountUnclearedReviewEntry(
  value: unknown,
  dateTo: string,
): value is AccountUnclearedReviewEntry {
  if (!isRecord(value)
    || typeof value.entryId !== 'string'
    || !value.entryId
    || typeof value.sourceId !== 'string'
    || !value.sourceId
    || (value.kind !== 'transaction' && value.kind !== 'transfer')
    || !isRfc3339DateTime(value.updatedAt)
    || value.cleared !== false
    || typeof value.occurredOn !== 'string'
    || !isValidCalendarDate(value.occurredOn)
    || value.occurredOn > dateTo
    || !Number.isSafeInteger(value.amountMinor)
    || value.amountMinor === 0
    || !Number.isSafeInteger(value.runningBalanceMinor)
    || typeof value.payee !== 'string'
    || typeof value.note !== 'string'
    || !isNullableString(value.categoryName)
    || !isNullableString(value.categoryLocalizationKey)
    || !isNullableString(value.counterpartyAccountName)
    || !isNullableString(value.counterpartyAccountLocalizationKey)
    || (value.transferDirection !== null
      && value.transferDirection !== 'in'
      && value.transferDirection !== 'out')) return false

  return value.kind === 'transfer'
    ? value.transferDirection === 'in' || value.transferDirection === 'out'
    : value.transferDirection === null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isNullableCalendarDate(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && isValidCalendarDate(value))
}

function isNullableSafeInteger(value: unknown): value is number | null {
  return value === null || Number.isSafeInteger(value)
}

function isRfc3339DateTime(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/,
  )
  if (!match) return false
  const [, year, month, day, hour, minute, second, offsetHour = '0', offsetMinute = '0'] = match
  return isValidCalendarDate(`${year}-${month}-${day}`)
    && Number(hour) <= 23
    && Number(minute) <= 59
    && Number(second) <= 59
    && Number(offsetHour) <= 23
    && Number(offsetMinute) <= 59
    && !Number.isNaN(Date.parse(value))
}
