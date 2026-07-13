import 'server-only'

import { calculateAccountRegisterBalances } from '../lib/accountRegister'
import { monthRangeDates } from '../lib/date'
import type {
  AccountLocalizationKey,
  AccountRegister,
  AccountRegisterEntry,
  CategoryLocalizationKey,
} from '../lib/schema'

type RegisterAccountRow = {
  id: number
  name: string
  localizationKey: AccountLocalizationKey | null
  openingBalanceMinor: number | null
  openingBalanceOn: string | null
}

type RegisterTotalRow = { amountMinor: number }

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
    CASE WHEN type = 'income' THEN amount_minor ELSE -amount_minor END AS amountMinor
  FROM transactions

  UNION ALL

  SELECT from_account_id, occurred_on, -amount_minor
  FROM account_transfers

  UNION ALL

  SELECT to_account_id, occurred_on, amount_minor
  FROM account_transfers
`

async function balanceBeforeMonth(
  database: D1Database,
  account: RegisterAccountRow,
  start: string,
) {
  const movement = await database.prepare(`
    WITH movements AS (${movementUnion})
    SELECT COALESCE(SUM(amountMinor), 0) AS amountMinor
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

async function listRegisterEntries(
  database: D1Database,
  account: RegisterAccountRow,
  start: string,
  end: string,
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
        AND account.opening_balance_on < ?

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
        AND item.occurred_on < ?

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
        AND transfer.occurred_on < ?
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
    LIMIT 200
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
  accountId: number,
  month: string,
): Promise<AccountRegister | null> {
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

  const { start, end } = monthRangeDates(month)
  if (account.openingBalanceOn && account.openingBalanceOn >= end) {
    return {
      accountId: account.id,
      accountName: account.name,
      accountLocalizationKey: account.localizationKey,
      month,
      availableFrom: account.openingBalanceOn,
      startingBalanceMinor: null,
      endingBalanceMinor: null,
      entryCount: 0,
      entries: [],
    }
  }

  const opensInsideMonth = Boolean(account.openingBalanceOn && account.openingBalanceOn > start)
  const startingBalanceMinor = opensInsideMonth
    ? null
    : await balanceBeforeMonth(database, account, start)
  const rows = await listRegisterEntries(database, account, start, end)
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
    availableFrom: opensInsideMonth ? account.openingBalanceOn : null,
    startingBalanceMinor,
    endingBalanceMinor,
    entryCount,
    entries,
  }
}
