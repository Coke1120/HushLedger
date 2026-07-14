import 'server-only'

import { calculateAccountRegisterBalances } from '../lib/accountRegister'
import { inclusiveMonthRangeDates } from '../lib/date'
import type {
  AccountLocalizationKey,
  AccountRegister,
  AccountRegisterEntry,
  CategoryLocalizationKey,
} from '../lib/schema'
import type { AccountRegisterQuery } from './validation'

type RegisterAccountRow = {
  id: number
  name: string
  localizationKey: AccountLocalizationKey | null
  openingBalanceMinor: number | null
  openingBalanceOn: string | null
}

type RegisterTotalRow = { amountMinor: number }

type RegisterBalanceRow = {
  recordedMovement: number
  clearedMovement: number
  unclearedCount: number
}

type RegisterEntryRow = {
  entryId: string
  sourceId: string | null
  kind: AccountRegisterEntry['kind']
  occurredOn: string
  createdAt: string
  amountMinor: number
  cleared: number | null
  payee: string
  note: string
  categoryName: string | null
  categoryLocalizationKey: CategoryLocalizationKey | null
  counterpartyAccountName: string | null
  counterpartyAccountLocalizationKey: AccountLocalizationKey | null
  transferDirection: AccountRegisterEntry['transferDirection']
  totalCount: number
  totalAmountMinor: number
}

const movementUnion = `
  SELECT
    account_id AS accountId,
    occurred_on AS occurredOn,
    CASE WHEN type = 'income' THEN amount_minor ELSE -amount_minor END AS recordedAmount,
    CASE
      WHEN cleared = 1 THEN CASE WHEN type = 'income' THEN amount_minor ELSE -amount_minor END
      ELSE 0
    END AS clearedAmount,
    CASE WHEN cleared = 0 THEN 1 ELSE 0 END AS unclearedCount
  FROM transactions

  UNION ALL

  SELECT
    from_account_id,
    occurred_on,
    -amount_minor,
    CASE WHEN from_cleared = 1 THEN -amount_minor ELSE 0 END,
    CASE WHEN from_cleared = 0 THEN 1 ELSE 0 END
  FROM account_transfers

  UNION ALL

  SELECT
    to_account_id,
    occurred_on,
    amount_minor,
    CASE WHEN to_cleared = 1 THEN amount_minor ELSE 0 END,
    CASE WHEN to_cleared = 0 THEN 1 ELSE 0 END
  FROM account_transfers
`

async function balanceBeforeRange(
  database: D1Database,
  account: RegisterAccountRow,
  start: string,
) {
  const movement = await database.prepare(`
    WITH movements AS (${movementUnion})
    SELECT COALESCE(SUM(recordedAmount), 0) AS amountMinor
    FROM movements
    WHERE accountId = ?
      AND occurredOn < ?
      AND (? IS NULL OR occurredOn >= ?)
  `).bind(
    account.id,
    start,
    account.openingBalanceOn,
    account.openingBalanceOn,
  ).first<RegisterTotalRow>()

  const opening = account.openingBalanceMinor ?? 0
  const amount = movement?.amountMinor ?? 0
  const balance = opening + amount
  if (![opening, amount, balance].every(Number.isSafeInteger)) {
    throw new Error('Account register starting balance exceeds the safe integer range')
  }
  return balance
}

async function balancesThroughCutoff(
  database: D1Database,
  account: RegisterAccountRow,
  dateTo: string,
) {
  const movement = await database.prepare(`
    WITH movements AS (${movementUnion})
    SELECT
      COALESCE(SUM(recordedAmount), 0) AS recordedMovement,
      COALESCE(SUM(clearedAmount), 0) AS clearedMovement,
      COALESCE(SUM(unclearedCount), 0) AS unclearedCount
    FROM movements
    WHERE accountId = ?
      AND occurredOn <= ?
      AND (? IS NULL OR occurredOn >= ?)
  `).bind(
    account.id,
    dateTo,
    account.openingBalanceOn,
    account.openingBalanceOn,
  ).first<RegisterBalanceRow>()

  const opening = account.openingBalanceMinor ?? 0
  const recordedMovement = movement?.recordedMovement ?? 0
  const clearedMovement = movement?.clearedMovement ?? 0
  const unclearedCount = movement?.unclearedCount ?? 0
  const recordedBalance = opening + recordedMovement
  const clearedBalance = opening + clearedMovement
  const unclearedBalance = recordedBalance - clearedBalance
  if (![opening, recordedMovement, clearedMovement, recordedBalance, clearedBalance, unclearedBalance]
    .every(Number.isSafeInteger)) {
    throw new Error('Account register cutoff balance exceeds the safe integer range')
  }
  if (!Number.isSafeInteger(unclearedCount) || unclearedCount < 0) {
    throw new Error('Account register uncleared count is invalid')
  }
  return { recordedBalance, clearedBalance, unclearedBalance, unclearedCount }
}

async function listRegisterEntries(
  database: D1Database,
  account: RegisterAccountRow,
  start: string,
  end: string,
  allEntries: boolean,
) {
  const activityStart = account.openingBalanceOn && account.openingBalanceOn > start
    ? account.openingBalanceOn
    : start
  const result = await database.prepare(`
    WITH entries AS (
      SELECT
        'opening:' || account.id || ':' || account.opening_balance_on AS entryId,
        NULL AS sourceId,
        'opening' AS kind,
        account.opening_balance_on AS occurredOn,
        '' AS createdAt,
        account.opening_balance_minor AS amountMinor,
        NULL AS cleared,
        '' AS payee,
        '' AS note,
        NULL AS categoryName,
        NULL AS categoryLocalizationKey,
        NULL AS counterpartyAccountName,
        NULL AS counterpartyAccountLocalizationKey,
        NULL AS transferDirection
      FROM accounts AS account
      WHERE account.id = ?
        AND account.opening_balance_on > ?
        AND account.opening_balance_on <= ?

      UNION ALL

      SELECT
        'transaction:' || item.id,
        item.id,
        'transaction',
        item.occurred_on,
        item.created_at,
        CASE WHEN item.type = 'income' THEN item.amount_minor ELSE -item.amount_minor END,
        item.cleared,
        item.payee,
        item.note,
        category.name,
        category.localization_key,
        NULL,
        NULL,
        NULL
      FROM transactions AS item
      INNER JOIN categories AS category ON category.id = item.category_id
      WHERE item.account_id = ?
        AND item.occurred_on >= ?
        AND item.occurred_on <= ?

      UNION ALL

      SELECT
        'transfer:' || transfer.id,
        transfer.id,
        'transfer',
        transfer.occurred_on,
        transfer.created_at,
        CASE WHEN transfer.from_account_id = ? THEN -transfer.amount_minor ELSE transfer.amount_minor END,
        CASE WHEN transfer.from_account_id = ? THEN transfer.from_cleared ELSE transfer.to_cleared END,
        '',
        transfer.note,
        NULL,
        NULL,
        counterparty.name,
        counterparty.localization_key,
        CASE WHEN transfer.from_account_id = ? THEN 'out' ELSE 'in' END
      FROM account_transfers AS transfer
      INNER JOIN accounts AS counterparty
        ON counterparty.id = CASE
          WHEN transfer.from_account_id = ? THEN transfer.to_account_id
          ELSE transfer.from_account_id
        END
      WHERE (transfer.from_account_id = ? OR transfer.to_account_id = ?)
        AND transfer.occurred_on >= ?
        AND transfer.occurred_on <= ?
    ), annotated AS (
      SELECT
        entries.*,
        COUNT(*) OVER () AS totalCount,
        SUM(amountMinor) OVER () AS totalAmountMinor
      FROM entries
    )
    SELECT *
    FROM annotated
    ORDER BY occurredOn DESC, createdAt DESC, entryId DESC
    ${allEntries ? '' : 'LIMIT 200'}
  `).bind(
    account.id,
    start,
    end,
    account.id,
    activityStart,
    end,
    account.id,
    account.id,
    account.id,
    account.id,
    account.id,
    account.id,
    activityStart,
    end,
  ).all<RegisterEntryRow>()

  return result.results
}

export async function getAccountRegister(
  database: D1Database,
  query: AccountRegisterQuery,
): Promise<AccountRegister | null> {
  return buildAccountRegister(database, query, false)
}

export async function getAccountRegisterForExport(
  database: D1Database,
  query: AccountRegisterQuery,
): Promise<AccountRegister | null> {
  return buildAccountRegister(database, query, true)
}

async function buildAccountRegister(
  database: D1Database,
  query: AccountRegisterQuery,
  allEntries: boolean,
): Promise<AccountRegister | null> {
  const accountId = query.accountId
  const account = await database.prepare(`
    SELECT
      id,
      name,
      localization_key AS localizationKey,
      opening_balance_minor AS openingBalanceMinor,
      opening_balance_on AS openingBalanceOn
    FROM accounts
    WHERE id = ?
    LIMIT 1
  `).bind(accountId).first<RegisterAccountRow>()
  if (!account) return null

  const range = 'month' in query
    ? inclusiveMonthRangeDates(query.month)
    : { start: query.dateFrom, end: query.dateTo }
  const month = 'month' in query ? query.month : query.dateTo.slice(0, 7)
  if (account.openingBalanceOn && account.openingBalanceOn > range.end) {
    return {
      accountId: account.id,
      accountName: account.name,
      accountLocalizationKey: account.localizationKey,
      month,
      dateFrom: range.start,
      dateTo: range.end,
      availableFrom: account.openingBalanceOn,
      startingBalanceMinor: null,
      endingBalanceMinor: null,
      clearedEndingBalanceMinor: null,
      unclearedEndingBalanceMinor: null,
      unclearedCount: null,
      entryCount: 0,
      entries: [],
    }
  }

  const opensInsideRange = Boolean(
    account.openingBalanceOn
      && account.openingBalanceOn > range.start
      && account.openingBalanceOn <= range.end,
  )
  const startingBalanceMinor = opensInsideRange
    ? null
    : await balanceBeforeRange(database, account, range.start)
  const [rows, cutoff] = await Promise.all([
    listRegisterEntries(database, account, range.start, range.end, allEntries),
    balancesThroughCutoff(database, account, range.end),
  ])
  const entryCount = rows[0]?.totalCount ?? 0
  const totalAmountMinor = rows[0]?.totalAmountMinor ?? 0
  if (!Number.isSafeInteger(entryCount) || entryCount < 0) {
    throw new Error('Account register entry count is invalid')
  }

  const { endingBalanceMinor, runningNewestFirst } = calculateAccountRegisterBalances(
    startingBalanceMinor ?? 0,
    totalAmountMinor,
    rows.map(({ amountMinor }) => amountMinor),
  )
  if (endingBalanceMinor !== cutoff.recordedBalance) {
    throw new Error('Account register range and cutoff balances disagree')
  }
  const entries = rows.map<AccountRegisterEntry>((row, index) => {
    const runningBalanceMinor = runningNewestFirst[index]
    if (runningBalanceMinor === undefined) {
      throw new Error('Account register running balance is missing')
    }
    return {
      entryId: row.entryId,
      sourceId: row.sourceId,
      kind: row.kind,
      occurredOn: row.occurredOn,
      amountMinor: row.amountMinor,
      runningBalanceMinor,
      cleared: row.cleared === null ? null : row.cleared === 1,
      payee: row.payee,
      note: row.note,
      categoryName: row.categoryName,
      categoryLocalizationKey: row.categoryLocalizationKey,
      counterpartyAccountName: row.counterpartyAccountName,
      counterpartyAccountLocalizationKey: row.counterpartyAccountLocalizationKey,
      transferDirection: row.transferDirection,
    }
  })

  return {
    accountId: account.id,
    accountName: account.name,
    accountLocalizationKey: account.localizationKey,
    month,
    dateFrom: range.start,
    dateTo: range.end,
    availableFrom: opensInsideRange ? account.openingBalanceOn : null,
    startingBalanceMinor,
    endingBalanceMinor,
    clearedEndingBalanceMinor: cutoff.clearedBalance,
    unclearedEndingBalanceMinor: cutoff.unclearedBalance,
    unclearedCount: cutoff.unclearedCount,
    entryCount,
    entries,
  }
}
