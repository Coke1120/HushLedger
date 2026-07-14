import 'server-only'

import { calculateAccountRegisterBalances } from '../lib/accountRegister'
import { inclusiveMonthRangeDates } from '../lib/date'
import type {
  AccountLocalizationKey,
  AccountRegister,
  AccountRegisterClearingInput,
  AccountRegisterEntry,
  AccountUnclearedReview,
  AccountUnclearedReviewEntry,
  CategoryLocalizationKey,
} from '../lib/schema'
import type {
  AccountRegisterQuery,
  AccountUnclearedReviewInput,
} from './validation'

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
  updatedAt: string | null
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

type UnclearedReviewRow = {
  accountId: number
  accountName: string
  accountLocalizationKey: AccountLocalizationKey | null
  openingBalanceMinor: number | null
  openingBalanceOn: string | null
  recordedMovement: number
  clearedMovement: number
  unclearedCount: number
  entryId: string | null
  sourceId: string | null
  kind: AccountRegisterEntry['kind'] | null
  occurredOn: string | null
  createdAt: string | null
  updatedAt: string | null
  amountMinor: number | null
  runningBalanceMinor: number | null
  cleared: number | null
  payee: string | null
  note: string | null
  categoryName: string | null
  categoryLocalizationKey: CategoryLocalizationKey | null
  counterpartyAccountName: string | null
  counterpartyAccountLocalizationKey: AccountLocalizationKey | null
  transferDirection: AccountRegisterEntry['transferDirection']
}

type ClearingUpdatedRow = { updatedAt: string }
type TransactionClearingStateRow = { accountId: number; updatedAt: string }
type TransferClearingStateRow = {
  fromAccountId: number
  toAccountId: number
  updatedAt: string
}

export type SetAccountRegisterEntryClearingResult =
  | { kind: 'updated'; id: string; updatedAt: string; cleared: boolean }
  | { kind: 'not_found' }
  | { kind: 'version_conflict' }
  | { kind: 'account_mismatch' }

const nextUpdatedAt = `
  CASE
    WHEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') > updated_at
      THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    ELSE strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+0.001 seconds')
  END
`

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
        NULL AS updatedAt,
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
        item.updated_at,
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
        transfer.updated_at,
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
      updatedAt: row.updatedAt,
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

export async function getAccountUnclearedReview(
  database: D1Database,
  input: AccountUnclearedReviewInput,
): Promise<AccountUnclearedReview | null> {
  const result = await database.prepare(`
    WITH selected_account AS (
      SELECT
        id,
        name,
        localization_key AS localizationKey,
        opening_balance_minor AS openingBalanceMinor,
        opening_balance_on AS openingBalanceOn
      FROM accounts
      WHERE id = ?
      LIMIT 1
    ), activity AS (
      SELECT
        'transaction:' || item.id AS entryId,
        item.id AS sourceId,
        'transaction' AS kind,
        item.occurred_on AS occurredOn,
        item.created_at AS createdAt,
        item.updated_at AS updatedAt,
        CASE WHEN item.type = 'income' THEN item.amount_minor ELSE -item.amount_minor END AS amountMinor,
        item.cleared AS cleared,
        item.payee AS payee,
        item.note AS note,
        category.name AS categoryName,
        category.localization_key AS categoryLocalizationKey,
        NULL AS counterpartyAccountName,
        NULL AS counterpartyAccountLocalizationKey,
        NULL AS transferDirection
      FROM transactions AS item
      INNER JOIN selected_account AS account ON account.id = item.account_id
      LEFT JOIN categories AS category ON category.id = item.category_id
      WHERE item.occurred_on <= ?
        AND (account.openingBalanceOn IS NULL OR item.occurred_on >= account.openingBalanceOn)

      UNION ALL

      SELECT
        'transfer:' || transfer.id,
        transfer.id,
        'transfer',
        transfer.occurred_on,
        transfer.created_at,
        transfer.updated_at,
        CASE WHEN transfer.from_account_id = account.id
          THEN -transfer.amount_minor ELSE transfer.amount_minor END,
        CASE WHEN transfer.from_account_id = account.id
          THEN transfer.from_cleared ELSE transfer.to_cleared END,
        '',
        transfer.note,
        NULL,
        NULL,
        counterparty.name,
        counterparty.localization_key,
        CASE WHEN transfer.from_account_id = account.id THEN 'out' ELSE 'in' END
      FROM account_transfers AS transfer
      INNER JOIN selected_account AS account
        ON account.id = transfer.from_account_id OR account.id = transfer.to_account_id
      LEFT JOIN accounts AS counterparty
        ON counterparty.id = CASE
          WHEN transfer.from_account_id = account.id
            THEN transfer.to_account_id
          ELSE transfer.from_account_id
        END
      WHERE transfer.occurred_on <= ?
        AND (account.openingBalanceOn IS NULL OR transfer.occurred_on >= account.openingBalanceOn)
    ), running AS (
      SELECT
        activity.*,
        COALESCE((SELECT openingBalanceMinor FROM selected_account), 0)
          + SUM(amountMinor) OVER (
            ORDER BY occurredOn ASC, createdAt ASC, entryId ASC
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          ) AS runningBalanceMinor
      FROM activity
    ), totals AS (
      SELECT
        COALESCE(SUM(amountMinor), 0) AS recordedMovement,
        COALESCE(SUM(CASE WHEN cleared = 1 THEN amountMinor ELSE 0 END), 0) AS clearedMovement,
        COALESCE(SUM(CASE WHEN cleared = 0 THEN 1 ELSE 0 END), 0) AS unclearedCount
      FROM activity
    )
    SELECT
      account.id AS accountId,
      account.name AS accountName,
      account.localizationKey AS accountLocalizationKey,
      account.openingBalanceMinor,
      account.openingBalanceOn,
      totals.recordedMovement,
      totals.clearedMovement,
      totals.unclearedCount,
      running.entryId,
      running.sourceId,
      running.kind,
      running.occurredOn,
      running.createdAt,
      running.updatedAt,
      running.amountMinor,
      running.runningBalanceMinor,
      running.cleared,
      running.payee,
      running.note,
      running.categoryName,
      running.categoryLocalizationKey,
      running.counterpartyAccountName,
      running.counterpartyAccountLocalizationKey,
      running.transferDirection
    FROM selected_account AS account
    CROSS JOIN totals
    LEFT JOIN running ON running.cleared = 0
    ORDER BY running.occurredOn DESC, running.createdAt DESC, running.entryId DESC
  `).bind(input.accountId, input.dateTo, input.dateTo).all<UnclearedReviewRow>()

  const first = result.results[0]
  if (!first) return null

  const beforeOpening = first.openingBalanceOn !== null && first.openingBalanceOn > input.dateTo
  const opening = first.openingBalanceMinor ?? 0
  const numericSnapshot = [
    opening,
    first.recordedMovement,
    first.clearedMovement,
    first.unclearedCount,
  ]
  if (!numericSnapshot.every(Number.isSafeInteger) || first.unclearedCount < 0) {
    throw new Error('Complete uncleared account review totals are invalid')
  }

  let endingBalanceMinor: number | null = null
  let clearedEndingBalanceMinor: number | null = null
  let unclearedEndingBalanceMinor: number | null = null
  if (!beforeOpening) {
    endingBalanceMinor = opening + first.recordedMovement
    clearedEndingBalanceMinor = opening + first.clearedMovement
    unclearedEndingBalanceMinor = endingBalanceMinor - clearedEndingBalanceMinor
    if (![endingBalanceMinor, clearedEndingBalanceMinor, unclearedEndingBalanceMinor]
      .every(Number.isSafeInteger)) {
      throw new Error('Complete uncleared account review balances exceed the safe integer range')
    }
  }

  const rows = result.results.filter((row) => row.entryId !== null)
  if (rows.length !== first.unclearedCount) {
    throw new Error('Complete uncleared account review count does not match its entries')
  }

  const entryIds = new Set<string>()
  const entries = rows.map<AccountUnclearedReviewEntry>((row) => {
    if (
      row.entryId === null
      || row.sourceId === null
      || (row.kind !== 'transaction' && row.kind !== 'transfer')
      || row.updatedAt === null
      || row.occurredOn === null
      || row.amountMinor === null
      || row.runningBalanceMinor === null
      || row.cleared !== 0
      || row.payee === null
      || row.note === null
      || entryIds.has(row.entryId)
      || !Number.isSafeInteger(row.amountMinor)
      || !Number.isSafeInteger(row.runningBalanceMinor)
    ) {
      throw new Error('Complete uncleared account review contains an invalid entry')
    }
    entryIds.add(row.entryId)
    return {
      entryId: row.entryId,
      sourceId: row.sourceId,
      kind: row.kind,
      updatedAt: row.updatedAt,
      occurredOn: row.occurredOn,
      amountMinor: row.amountMinor,
      runningBalanceMinor: row.runningBalanceMinor,
      cleared: false,
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
    complete: true,
    accountId: first.accountId,
    accountName: first.accountName,
    accountLocalizationKey: first.accountLocalizationKey,
    dateTo: input.dateTo,
    availableFrom: first.openingBalanceOn,
    endingBalanceMinor,
    clearedEndingBalanceMinor,
    unclearedEndingBalanceMinor,
    unclearedCount: first.unclearedCount,
    entries,
  }
}

export async function setAccountRegisterEntryClearing(
  database: D1Database,
  input: AccountRegisterClearingInput,
): Promise<SetAccountRegisterEntryClearingResult> {
  return input.kind === 'transaction'
    ? setTransactionClearing(database, input)
    : setTransferLegClearing(database, input)
}

async function setTransactionClearing(
  database: D1Database,
  input: AccountRegisterClearingInput,
): Promise<SetAccountRegisterEntryClearingResult> {
  const updated = await database.prepare(`
    UPDATE transactions
    SET
      cleared = ?,
      updated_at = ${nextUpdatedAt}
    WHERE id = ? AND account_id = ? AND updated_at = ?
    RETURNING updated_at AS updatedAt
  `).bind(
    input.cleared ? 1 : 0,
    input.sourceId,
    input.accountId,
    input.updatedAt,
  ).run<ClearingUpdatedRow>()
  const row = updated.results[0]
  if (row) return clearingUpdated(input, row)

  return classifyTransactionClearingFailure(database, input)
}

async function setTransferLegClearing(
  database: D1Database,
  input: AccountRegisterClearingInput,
): Promise<SetAccountRegisterEntryClearingResult> {
  const current = await transferClearingState(database, input.sourceId)
  if (!current) return { kind: 'not_found' }
  if (current.fromAccountId !== input.accountId && current.toAccountId !== input.accountId) {
    return { kind: 'account_mismatch' }
  }
  if (current.updatedAt !== input.updatedAt) return { kind: 'version_conflict' }

  const isFromLeg = current.fromAccountId === input.accountId
  const updated = await database.prepare(`
    UPDATE account_transfers
    SET
      ${isFromLeg ? 'from_cleared' : 'to_cleared'} = ?,
      updated_at = ${nextUpdatedAt}
    WHERE id = ?
      AND ${isFromLeg ? 'from_account_id' : 'to_account_id'} = ?
      AND updated_at = ?
    RETURNING updated_at AS updatedAt
  `).bind(
    input.cleared ? 1 : 0,
    input.sourceId,
    input.accountId,
    input.updatedAt,
  ).run<ClearingUpdatedRow>()
  const row = updated.results[0]
  if (row) return clearingUpdated(input, row)

  const latest = await transferClearingState(database, input.sourceId)
  if (!latest) return { kind: 'not_found' }
  if (latest.fromAccountId !== input.accountId && latest.toAccountId !== input.accountId) {
    return { kind: 'account_mismatch' }
  }
  return { kind: 'version_conflict' }
}

async function classifyTransactionClearingFailure(
  database: D1Database,
  input: AccountRegisterClearingInput,
): Promise<SetAccountRegisterEntryClearingResult> {
  const current = await database.prepare(`
    SELECT account_id AS accountId, updated_at AS updatedAt
    FROM transactions
    WHERE id = ?
    LIMIT 1
  `).bind(input.sourceId).first<TransactionClearingStateRow>()
  if (!current) return { kind: 'not_found' }
  return current.accountId === input.accountId
    ? { kind: 'version_conflict' }
    : { kind: 'account_mismatch' }
}

function transferClearingState(database: D1Database, id: string) {
  return database.prepare(`
    SELECT
      from_account_id AS fromAccountId,
      to_account_id AS toAccountId,
      updated_at AS updatedAt
    FROM account_transfers
    WHERE id = ?
    LIMIT 1
  `).bind(id).first<TransferClearingStateRow>()
}

function clearingUpdated(
  input: AccountRegisterClearingInput,
  row: ClearingUpdatedRow,
): SetAccountRegisterEntryClearingResult {
  if (typeof row.updatedAt !== 'string' || row.updatedAt <= input.updatedAt) {
    throw new Error('Account register clearing update did not advance its version')
  }
  return {
    kind: 'updated',
    id: input.sourceId,
    updatedAt: row.updatedAt,
    cleared: input.cleared,
  }
}
