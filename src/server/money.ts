import 'server-only'

import type { SupportedCurrency } from '../lib/currency'
import {
  buildLegacySpendingTrendRows,
  buildMonthlyCashFlowTrend,
  type MonthlyCashFlowQueryRow,
} from '../lib/cashFlowTrend'
import { currentHongKongDate, monthRangeDates, shiftMonth } from '../lib/date'
import { exactTransactionTotals } from '../lib/money'
import { buildNetWorthTrend, netWorthTrendMonths } from '../lib/netWorthTrend'
import { mergePayeeSummaries, normalizePayee } from '../lib/payeeMemory'
import {
  recurringForecastForMonth,
  recurringForecastForRange,
  recurringTransferForecastForMonth,
  recurringTransferForecastForRange,
  type RecurringForecastRule,
  type RecurringTransferForecastRule,
} from '../lib/recurringForecast'
import { buildMonthlySpendingTrend } from '../lib/spendingTrend'
import { TRANSACTION_PAGE_SIZE } from '../lib/schema'
import type {
  Account,
  AccountBalance,
  AccountLocalizationKey,
  Category,
  CategoryLocalizationKey,
  ExpenseCategorySummary,
  ExpensePayeeSummary,
  ImportReviewStatus,
  MonthlySpendingPlanSummary,
  NetWorthTrendPoint,
  PayeeSuggestion,
  Summary,
  Transaction,
  TransactionCategoryBatchInput,
  TransactionClearingBatchInput,
  TransactionFilterSummary,
  TransactionInput,
  TransactionImportReviewBatchInput,
  TransactionPageCursor,
  TransactionPageQuery,
  TransactionQuery,
  TransactionSort,
  TransactionUpdateInput,
  TransactionType,
} from '../lib/schema'
import type { ReferenceErrorCode } from './recurring'

type AccountRow = Omit<Account, 'isActive'> & { isActive: number }
type CategoryRow = Omit<Category, 'isActive'> & { isActive: number }

type TransactionRow = {
  id: string
  type: TransactionType
  amountMinor: number
  currency: SupportedCurrency
  accountId: number
  categoryId: number
  occurredOn: string
  cleared: number
  payee: string
  payeeBlank: 0 | 1
  note: string
  accountName: string
  accountLocalizationKey: AccountLocalizationKey | null
  categoryName: string
  categoryLocalizationKey: CategoryLocalizationKey | null
  categoryIcon: string
  categoryColor: string
  recurringRuleId: string | null
  recurringRuleName: string | null
  recurrenceDueOn: string | null
  importReviewStatus: ImportReviewStatus | null
  createdAt: string
  updatedAt: string
}

type ReferenceRow = {
  id: number
  isActive: number
  currency?: string
  type?: string
}

type SummaryRow = {
  income: number
  expense: number
}

type ExpenseCategoryQueryRow = ExpenseCategorySummary & {
  previousMonthAmountMinor: number
}

type TransactionFilterSummaryRow = Omit<TransactionFilterSummary, 'net'>

export type TransactionView = Omit<Transaction, 'recurringRuleId' | 'recurringRuleName'> & {
  recurringRuleId: string | null
  recurringRuleName: string | null
  recurrenceDueOn: string | null
}

export type TransactionPage = {
  transactions: TransactionView[]
  nextCursor: TransactionPageCursor | null
}

export type CreateTransactionResult =
  | { kind: 'created' | 'existing'; transaction: TransactionView }
  | { kind: 'id_conflict' }
  | { kind: 'reference_invalid'; code: ReferenceErrorCode }

export type UpdateTransactionResult =
  | { kind: 'updated'; transaction: TransactionView }
  | { kind: 'not_found' }
  | { kind: 'version_conflict' }
  | { kind: 'reference_invalid'; code: ReferenceErrorCode }

export type DeleteTransactionResult =
  | { kind: 'deleted'; id: string }
  | { kind: 'not_found' }
  | { kind: 'version_conflict' }

export type SetTransactionsClearingResult =
  | { kind: 'updated'; count: number }
  | { kind: 'version_conflict' }

export type SetTransactionsCategoryResult =
  | { kind: 'updated'; count: number }
  | { kind: 'version_conflict' }
  | { kind: 'reference_invalid'; code: 'CATEGORY_INVALID' | 'CATEGORY_TYPE_MISMATCH' }

export type SetTransactionsImportReviewStatusResult =
  | { kind: 'updated'; count: number }
  | { kind: 'version_conflict' }

type TransactionCategoryGuardRow = {
  desiredCount: number
  currentCount: number
  compatibleCount: number
  targetActive: number
}

const transactionSelect = `
  SELECT
    t.id,
    t.type,
    t.amount_minor AS amountMinor,
    t.currency,
    t.account_id AS accountId,
    t.category_id AS categoryId,
    t.occurred_on AS occurredOn,
    t.cleared,
    t.payee,
    (trim(t.payee) = '') AS payeeBlank,
    t.note,
    a.name AS accountName,
    a.localization_key AS accountLocalizationKey,
    category.name AS categoryName,
    category.localization_key AS categoryLocalizationKey,
    category.icon AS categoryIcon,
    category.color AS categoryColor,
    t.recurring_rule_id AS recurringRuleId,
    t.recurring_rule_name AS recurringRuleName,
    t.recurrence_due_on AS recurrenceDueOn,
    t.import_review_status AS importReviewStatus,
    t.created_at AS createdAt,
    t.updated_at AS updatedAt
  FROM transactions t
  INNER JOIN accounts a ON a.id = t.account_id
  INNER JOIN categories category ON category.id = t.category_id
`

export async function checkHealth(database: D1Database) {
  await database.prepare('SELECT 1 AS ready').first<{ ready: number }>()
}

export async function listAccounts(database: D1Database): Promise<Account[]> {
  const result = await database.prepare(`
    SELECT
      id,
      name,
      type,
      currency,
      is_active AS isActive,
      sort_order AS sortOrder,
      localization_key AS localizationKey,
      opening_balance_minor AS openingBalanceMinor,
      opening_balance_on AS openingBalanceOn,
      updated_at AS updatedAt
    FROM accounts
    ORDER BY is_active DESC, sort_order ASC, id ASC
  `).all<AccountRow>()

  return result.results.map((row) => ({ ...row, isActive: row.isActive === 1 }))
}

type AccountBalanceRow = Omit<AccountBalance, 'isActive' | 'unclearedCount'> & {
  isActive: number
  unclearedCount: number | null
}
type MonthlyAccountBalanceRow = AccountBalanceRow & { month: string }

async function listAccountBalancesByMonth(
  database: D1Database,
  months: string[],
): Promise<Map<string, AccountBalance[]>> {
  const balancesByMonth = new Map(months.map((month) => [month, [] as AccountBalance[]]))
  if (months.length === 0) return balancesByMonth

  const ranges = months.map((month) => ({ month, end: monthRangeDates(month).end }))
  const maxEnd = ranges.reduce(
    (latest, range) => range.end > latest ? range.end : latest,
    ranges[0]?.end ?? '',
  )
  const monthValues = ranges.map(() => '(?, ?)').join(', ')
  const monthBindings = ranges.flatMap(({ month, end }) => [month, end])
  const result = await database.prepare(`
    WITH months(month, endDate) AS (
      VALUES ${monthValues}
    ), movements AS (
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
      WHERE occurred_on < ?

      UNION ALL

      SELECT
        from_account_id AS accountId,
        occurred_on AS occurredOn,
        -amount_minor AS recordedAmount,
        CASE WHEN from_cleared = 1 THEN -amount_minor ELSE 0 END AS clearedAmount,
        CASE WHEN from_cleared = 0 THEN 1 ELSE 0 END AS unclearedCount
      FROM account_transfers
      WHERE occurred_on < ?

      UNION ALL

      SELECT
        to_account_id AS accountId,
        occurred_on AS occurredOn,
        amount_minor AS recordedAmount,
        CASE WHEN to_cleared = 1 THEN amount_minor ELSE 0 END AS clearedAmount,
        CASE WHEN to_cleared = 0 THEN 1 ELSE 0 END AS unclearedCount
      FROM account_transfers
      WHERE occurred_on < ?
    ), totals AS (
      SELECT
        months.month,
        months.endDate,
        account.id AS accountId,
        COALESCE(SUM(CASE
          WHEN account.opening_balance_on IS NULL OR movement.occurredOn >= account.opening_balance_on
          THEN movement.recordedAmount
          ELSE 0
        END), 0) AS recordedMovement,
        COALESCE(SUM(CASE
          WHEN account.opening_balance_on IS NULL OR movement.occurredOn >= account.opening_balance_on
          THEN movement.clearedAmount
          ELSE 0
        END), 0) AS clearedMovement,
        COALESCE(SUM(CASE
          WHEN account.opening_balance_on IS NULL OR movement.occurredOn >= account.opening_balance_on
          THEN movement.unclearedCount
          ELSE 0
        END), 0) AS unclearedCount
      FROM months
      CROSS JOIN accounts AS account
      LEFT JOIN movements AS movement
        ON movement.accountId = account.id
        AND movement.occurredOn < months.endDate
      GROUP BY months.month, months.endDate, account.id
    )
    SELECT
      totals.month,
      account.id AS accountId,
      account.name AS accountName,
      account.localization_key AS accountLocalizationKey,
      account.type AS accountType,
      account.is_active AS isActive,
      account.opening_balance_minor AS openingBalanceMinor,
      account.opening_balance_on AS openingBalanceOn,
      CASE
        WHEN account.opening_balance_on IS NOT NULL AND account.opening_balance_on >= totals.endDate THEN NULL
        ELSE COALESCE(account.opening_balance_minor, 0) + totals.recordedMovement
      END AS recordedBalance,
      CASE
        WHEN account.opening_balance_on IS NOT NULL AND account.opening_balance_on >= totals.endDate THEN NULL
        ELSE COALESCE(account.opening_balance_minor, 0) + totals.clearedMovement
      END AS clearedBalance,
      CASE
        WHEN account.opening_balance_on IS NOT NULL AND account.opening_balance_on >= totals.endDate THEN NULL
        ELSE totals.recordedMovement - totals.clearedMovement
      END AS unclearedBalance,
      CASE
        WHEN account.opening_balance_on IS NOT NULL AND account.opening_balance_on >= totals.endDate THEN NULL
        ELSE totals.unclearedCount
      END AS unclearedCount
    FROM totals
    INNER JOIN accounts AS account ON account.id = totals.accountId
    ORDER BY totals.month ASC, account.is_active DESC, account.sort_order ASC, account.id ASC
  `).bind(...monthBindings, maxEnd, maxEnd, maxEnd).all<MonthlyAccountBalanceRow>()

  for (const { month, ...row } of result.results) {
    for (const value of [row.recordedBalance, row.clearedBalance, row.unclearedBalance]) {
      if (value !== null && !Number.isSafeInteger(value)) {
        throw new Error('Account balance exceeds the safe integer range')
      }
    }
    if (row.unclearedCount !== null
      && (!Number.isSafeInteger(row.unclearedCount) || row.unclearedCount < 0)) {
      throw new Error('Account uncleared count is invalid')
    }
    balancesByMonth.get(month)?.push({ ...row, isActive: row.isActive === 1 })
  }

  return balancesByMonth
}

export async function listAccountBalances(
  database: D1Database,
  month: string,
): Promise<AccountBalance[]> {
  return (await listAccountBalancesByMonth(database, [month])).get(month) ?? []
}

export async function listNetWorthTrend(
  database: D1Database,
  month: string,
): Promise<NetWorthTrendPoint[]> {
  const months = netWorthTrendMonths(month)
  return buildNetWorthTrend(month, await listAccountBalancesByMonth(database, months))
}

export async function listCategories(database: D1Database): Promise<Category[]> {
  const result = await database.prepare(`
    SELECT
      id,
      name,
      type,
      icon,
      color,
      is_active AS isActive,
      sort_order AS sortOrder,
      localization_key AS localizationKey,
      monthly_plan_minor AS monthlyPlanMinor,
      updated_at AS updatedAt
    FROM categories
    ORDER BY type DESC, is_active DESC, sort_order ASC, id ASC
  `).all<CategoryRow>()

  return result.results.map((row) => ({ ...row, isActive: row.isActive === 1 }))
}

export async function listPayeeSuggestions(database: D1Database): Promise<PayeeSuggestion[]> {
  const result = await database.prepare(`
    WITH ranked AS (
      SELECT
        trim(payee) AS payee,
        type,
        account_id AS accountId,
        category_id AS categoryId,
        occurred_on AS lastUsedOn,
        COUNT(*) OVER (
          PARTITION BY lower(trim(payee)), type
        ) AS useCount,
        ROW_NUMBER() OVER (
          PARTITION BY lower(trim(payee)), type
          ORDER BY occurred_on DESC, created_at DESC, id DESC
        ) AS recency
      FROM transactions
      WHERE trim(payee) <> ''
    )
    SELECT payee, type, accountId, categoryId, lastUsedOn, useCount
    FROM ranked
    WHERE recency = 1
    ORDER BY lastUsedOn DESC, payee COLLATE NOCASE ASC
    LIMIT 100
  `).all<PayeeSuggestion>()

  return result.results
}

export async function listTransactions(
  database: D1Database,
  query: TransactionQuery,
): Promise<TransactionView[]> {
  return selectTransactions(database, query, TRANSACTION_PAGE_SIZE)
}

export async function listTransactionsForExport(
  database: D1Database,
  query: TransactionQuery,
): Promise<TransactionView[]> {
  return selectTransactions(database, query, null)
}

export async function readLedgerRevision(database: D1Database) {
  const row = await database.prepare('SELECT revision FROM ledger_state WHERE id = 1')
    .first<{ revision: number }>()
  if (!row || !Number.isSafeInteger(row.revision) || row.revision < 1) {
    throw new Error('Ledger revision is missing or unsafe')
  }
  return row.revision
}

export function transactionPageQueryKey(query: TransactionPageQuery) {
  const filters = { ...query }
  delete filters.cursor
  const sort = filters.sort ?? 'date_desc'
  delete filters.sort
  return JSON.stringify({ ...filters, sort })
}

export async function listTransactionPage(
  database: D1Database,
  query: TransactionPageQuery,
  revision: number,
): Promise<TransactionPage> {
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new Error('Transaction page revision is unsafe')
  }
  const queryKey = transactionPageQueryKey(query)
  if (query.cursor && (
    query.cursor.revision !== revision
    || query.cursor.queryKey !== queryKey
  )) {
    throw new Error('Transaction cursor does not match its snapshot or query')
  }

  const rows = await selectTransactionRows(
    database,
    query,
    TRANSACTION_PAGE_SIZE + 1,
    query.cursor ?? null,
  )
  const pageRows = rows.slice(0, TRANSACTION_PAGE_SIZE)
  const lastRow = pageRows.at(-1)
  const nextCursor = rows.length > TRANSACTION_PAGE_SIZE && lastRow
    ? transactionCursor(lastRow, query.sort ?? 'date_desc', revision, queryKey)
    : null

  return {
    transactions: pageRows.map(transactionView),
    nextCursor,
  }
}

type TransactionCursorColumn = {
  expression: string
  direction: 'ASC' | 'DESC'
  value: (cursor: TransactionPageCursor) => string | number
}

const baseDescendingColumns: readonly TransactionCursorColumn[] = [
  { expression: 't.occurred_on', direction: 'DESC', value: (cursor) => cursor.occurredOn },
  { expression: 't.created_at', direction: 'DESC', value: (cursor) => cursor.createdAt },
  { expression: 't.id', direction: 'DESC', value: (cursor) => cursor.id },
]

const transactionSortColumns: Record<TransactionSort, readonly TransactionCursorColumn[]> = {
  date_desc: baseDescendingColumns,
  date_asc: [
    { expression: 't.occurred_on', direction: 'ASC', value: (cursor) => cursor.occurredOn },
    { expression: 't.created_at', direction: 'ASC', value: (cursor) => cursor.createdAt },
    { expression: 't.id', direction: 'ASC', value: (cursor) => cursor.id },
  ],
  amount_desc: [
    { expression: 't.amount_minor', direction: 'DESC', value: (cursor) => cursor.amountMinor },
    ...baseDescendingColumns,
  ],
  amount_asc: [
    { expression: 't.amount_minor', direction: 'ASC', value: (cursor) => cursor.amountMinor },
    ...baseDescendingColumns,
  ],
  payee_asc: [
    { expression: "(trim(t.payee) = '')", direction: 'ASC', value: (cursor) => cursor.payeeBlank },
    { expression: 't.payee COLLATE NOCASE', direction: 'ASC', value: (cursor) => cursor.payee },
    ...baseDescendingColumns,
  ],
  payee_desc: [
    { expression: "(trim(t.payee) = '')", direction: 'ASC', value: (cursor) => cursor.payeeBlank },
    { expression: 't.payee COLLATE NOCASE', direction: 'DESC', value: (cursor) => cursor.payee },
    ...baseDescendingColumns,
  ],
}

function transactionCursor(
  row: TransactionRow,
  sort: TransactionSort,
  revision: number,
  queryKey: string,
): TransactionPageCursor {
  return {
    version: 1,
    revision,
    queryKey,
    sort,
    payeeBlank: row.payeeBlank,
    amountMinor: row.amountMinor,
    occurredOn: row.occurredOn,
    payee: row.payee,
    createdAt: row.createdAt,
    id: row.id,
  }
}

function transactionCursorWhere(cursor: TransactionPageCursor) {
  const columns = transactionSortColumns[cursor.sort]
  const values: Array<string | number> = []
  const alternatives = columns.map((column, index) => {
    const conditions: string[] = []
    for (const prior of columns.slice(0, index)) {
      conditions.push(`${prior.expression} = ?`)
      values.push(prior.value(cursor))
    }
    conditions.push(`${column.expression} ${column.direction === 'ASC' ? '>' : '<'} ?`)
    values.push(column.value(cursor))
    return `(${conditions.join(' AND ')})`
  })
  return { clause: alternatives.join(' OR '), values }
}

function transactionQueryWhere(query: TransactionQuery) {
  const filters: string[] = []
  const values: Array<string | number> = []

  if (query.scope === 'month') {
    const { start, end } = monthRangeDates(query.month)
    filters.push('t.occurred_on >= ?', 't.occurred_on < ?')
    values.push(start, end)
  } else if (query.scope === 'range') {
    filters.push('t.occurred_on >= ?', 't.occurred_on <= ?')
    values.push(query.dateFrom!, query.dateTo!)
  }

  if (query.type) {
    filters.push('t.type = ?')
    values.push(query.type)
  }

  if (query.accountId) {
    filters.push('t.account_id = ?')
    values.push(query.accountId)
  }

  if (query.categoryId) {
    filters.push('t.category_id = ?')
    values.push(query.categoryId)
  }

  if (query.amountMinor) {
    filters.push('t.amount_minor = ?')
    values.push(query.amountMinor)
  }

  if (query.payee) {
    filters.push("trim(t.payee) <> ''")
  }

  if (query.status) {
    filters.push('t.cleared = ?')
    values.push(query.status === 'cleared' ? 1 : 0)
  }

  if (query.importReviewStatus) {
    filters.push('t.import_review_status = ?')
    values.push(query.importReviewStatus)
  }

  if (query.search) {
    const search = `%${escapeLike(query.search)}%`
    filters.push(`(
      t.payee LIKE ? ESCAPE '\\'
      OR t.note LIKE ? ESCAPE '\\'
      OR a.name LIKE ? ESCAPE '\\'
      OR category.name LIKE ? ESCAPE '\\'
    )`)
    values.push(search, search, search, search)
  }

  if (query.tag) {
    filters.push(`instr(
      ' ' || replace(replace(replace(t.note, char(9), ' '), char(10), ' '), char(13), ' ') || ' ',
      ' ' || ? || ' '
    ) > 0`)
    values.push(`#${query.tag}`)
  }

  if (query.duplicates === 'exact') {
    filters.push(`EXISTS (
      SELECT 1
      FROM transactions duplicate
      WHERE duplicate.id <> t.id
        AND duplicate.type = t.type
        AND duplicate.amount_minor = t.amount_minor
        AND duplicate.currency = t.currency
        AND duplicate.account_id = t.account_id
        AND duplicate.category_id = t.category_id
        AND duplicate.occurred_on = t.occurred_on
        AND duplicate.payee = t.payee
        AND duplicate.note = t.note
    )`)
  }

  return { clause: filters.length > 0 ? filters.join(' AND ') : '1 = 1', values }
}

export async function summarizeTransactions(
  database: D1Database,
  query: TransactionQuery,
): Promise<TransactionFilterSummary> {
  if (query.payee) {
    // ponytail: D1 has no Unicode case folding; scan the already-filtered personal ledger.
    // Add an indexed normalized payee key if this becomes a measured bottleneck.
    const transactions = await selectTransactions(database, query, null)
    return { transactionCount: transactions.length, ...exactTransactionTotals(transactions) }
  }

  const { clause, values } = transactionQueryWhere(query)
  const row = await database.prepare(`
    SELECT
      COUNT(*) AS transactionCount,
      TOTAL(CASE WHEN t.type = 'income' THEN t.amount_minor ELSE 0 END) AS income,
      TOTAL(CASE WHEN t.type = 'expense' THEN t.amount_minor ELSE 0 END) AS expense
    FROM transactions t
    INNER JOIN accounts a ON a.id = t.account_id
    INNER JOIN categories category ON category.id = t.category_id
    WHERE ${clause}
  `)
    .bind(...values)
    .first<TransactionFilterSummaryRow>()

  if (!row) throw new Error('Transaction summary aggregate is missing')
  if (!Number.isSafeInteger(row.transactionCount) || row.transactionCount < 0) {
    throw new Error('Transaction count exceeds the safe integer range')
  }
  const totals = exactTransactionTotals([
    { type: 'income', amountMinor: row.income },
    { type: 'expense', amountMinor: row.expense },
  ])
  return { transactionCount: row.transactionCount, ...totals }
}

async function selectTransactions(
  database: D1Database,
  query: TransactionQuery,
  limit: number | null,
): Promise<TransactionView[]> {
  return (await selectTransactionRows(database, query, limit, null)).map(transactionView)
}

async function selectTransactionRows(
  database: D1Database,
  query: TransactionQuery | TransactionPageQuery,
  limit: number | null,
  cursor: TransactionPageCursor | null,
): Promise<TransactionRow[]> {
  const { clause, values } = transactionQueryWhere(query)
  const normalizedPayee = query.payee ? normalizePayee(query.payee) : null
  const sort = query.sort ?? 'date_desc'
  const cursorWhere = cursor ? transactionCursorWhere(cursor) : null
  const bindings = [...values, ...(cursorWhere?.values ?? [])]
  const sqlLimit = limit !== null && normalizedPayee === null
  if (sqlLimit) bindings.push(limit)

  const result = await database.prepare(`
    ${transactionSelect}
    WHERE (${clause})
      ${cursorWhere ? `AND (${cursorWhere.clause})` : ''}
    ORDER BY ${transactionSortColumns[sort]
      .map(({ expression, direction }) => `${expression} ${direction}`)
      .join(', ')}
    ${sqlLimit ? 'LIMIT ?' : ''}
  `)
    .bind(...bindings)
    .all<TransactionRow>()

  const rows = result.results
    .filter((row) => (
      normalizedPayee === null || normalizePayee(row.payee) === normalizedPayee
    ))
  return limit === null ? rows : rows.slice(0, limit)
}

export async function createTransaction(
  database: D1Database,
  input: TransactionInput,
): Promise<CreateTransactionResult> {
  const existing = await getTransaction(database, input.id)
  if (existing) {
    return matchesInput(existing, input)
      ? { kind: 'existing', transaction: existing }
      : { kind: 'id_conflict' }
  }

  const reservedImportId = await database.prepare(`
    SELECT 1 AS found
    FROM transaction_import_keys
    WHERE transaction_id = ?
    LIMIT 1
  `).bind(input.id).first<{ found: number }>()
  if (reservedImportId) return { kind: 'id_conflict' }

  const referenceError = await validateReferences(database, input)
  if (referenceError) return { kind: 'reference_invalid', code: referenceError }

  const inserted = await database.prepare(`
    INSERT INTO transactions(
      id,
      type,
      amount_minor,
      currency,
      account_id,
      category_id,
      occurred_on,
      cleared,
      payee,
      note
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE EXISTS (
      SELECT 1
      FROM accounts
      WHERE id = ? AND is_active = 1 AND currency = ?
    )
      AND EXISTS (
      SELECT 1
      FROM categories
      WHERE id = ? AND is_active = 1 AND type = ?
    )
      AND NOT EXISTS (
        SELECT 1
        FROM transaction_import_keys
        WHERE transaction_id = ?
      )
    ON CONFLICT(id) DO NOTHING
  `)
    .bind(
      input.id,
      input.type,
      input.amountMinor,
      input.currency,
      input.accountId,
      input.categoryId,
      input.occurredOn,
      input.cleared ? 1 : 0,
      input.payee,
      input.note,
      input.accountId,
      input.currency,
      input.categoryId,
      input.type,
      input.id,
    )
    .run()

  const transaction = await getTransaction(database, input.id)
  if (!transaction) {
    const currentReferenceError = await validateReferences(database, input)
    if (currentReferenceError) {
      return { kind: 'reference_invalid', code: currentReferenceError }
    }
    const currentReservedImportId = await database.prepare(`
      SELECT 1 AS found
      FROM transaction_import_keys
      WHERE transaction_id = ?
      LIMIT 1
    `).bind(input.id).first<{ found: number }>()
    if (currentReservedImportId) return { kind: 'id_conflict' }
    throw new Error('Transaction insert did not produce a row')
  }
  if (!matchesInput(transaction, input)) return { kind: 'id_conflict' }

  return {
    kind: Number(inserted.meta.changes) > 0 ? 'created' : 'existing',
    transaction,
  }
}

export async function updateTransaction(
  database: D1Database,
  id: string,
  input: TransactionUpdateInput,
): Promise<UpdateTransactionResult> {
  const existing = await getTransaction(database, id)
  if (!existing) return { kind: 'not_found' }
  if (existing.updatedAt !== input.updatedAt) return { kind: 'version_conflict' }

  const referenceError = await validateReferences(database, input, {
    accountId: existing.accountId,
    categoryId: existing.categoryId,
  })
  if (referenceError) return { kind: 'reference_invalid', code: referenceError }

  const updated = await database.prepare(`
    UPDATE transactions
    SET
      type = ?,
      amount_minor = ?,
      currency = ?,
      account_id = ?,
      category_id = ?,
      occurred_on = ?,
      cleared = ?,
      payee = ?,
      note = ?,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ? AND updated_at = ?
      AND EXISTS (
        SELECT 1
        FROM accounts
        WHERE id = ?
          AND currency = ?
          AND (is_active = 1 OR id = ?)
      )
      AND EXISTS (
        SELECT 1
        FROM categories
        WHERE id = ?
          AND type = ?
          AND (is_active = 1 OR id = ?)
      )
  `)
    .bind(
      input.type,
      input.amountMinor,
      input.currency,
      input.accountId,
      input.categoryId,
      input.occurredOn,
      input.cleared ? 1 : 0,
      input.payee,
      input.note,
      id,
      input.updatedAt,
      input.accountId,
      input.currency,
      existing.accountId,
      input.categoryId,
      input.type,
      existing.categoryId,
    )
    .run()

  if (Number(updated.meta.changes) === 0) {
    const current = await getTransaction(database, id)
    return current ? { kind: 'version_conflict' } : { kind: 'not_found' }
  }

  const transaction = await getTransaction(database, id)
  if (!transaction) throw new Error('Transaction update did not produce a row')
  return { kind: 'updated', transaction }
}

export async function setTransactionsClearing(
  database: D1Database,
  input: TransactionClearingBatchInput,
): Promise<SetTransactionsClearingResult> {
  const desired = JSON.stringify(input.transactions)
  const updated = await database.prepare(`
    WITH
    desired AS (
      SELECT
        json_extract(value, '$.id') AS desired_id,
        json_extract(value, '$.updatedAt') AS expected_updated_at
      FROM json_each(?)
    ),
    clearing_guard AS (
      SELECT
        (SELECT COUNT(*) FROM desired) AS desired_count,
        (
          SELECT COUNT(*)
          FROM desired
          INNER JOIN transactions AS current ON current.id = desired.desired_id
          WHERE current.updated_at = desired.expected_updated_at
        ) AS matched_count
    )
    UPDATE transactions
    SET
      cleared = ?,
      updated_at = CASE
        WHEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') > updated_at
          THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        ELSE strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+0.001 seconds')
      END
    WHERE id IN (SELECT desired_id FROM desired)
      AND (
        SELECT desired_count = matched_count
        FROM clearing_guard
      )
  `).bind(desired, input.cleared ? 1 : 0).run()

  return Number(updated.meta.changes) > 0
    ? { kind: 'updated', count: input.transactions.length }
    : { kind: 'version_conflict' }
}

export async function setTransactionsCategory(
  database: D1Database,
  input: TransactionCategoryBatchInput,
): Promise<SetTransactionsCategoryResult> {
  const desired = JSON.stringify(input.transactions)
  const guard = database.prepare(`
    WITH
    desired AS (
      SELECT
        json_extract(value, '$.id') AS desired_id,
        json_extract(value, '$.updatedAt') AS expected_updated_at
      FROM json_each(?)
    ),
    target AS (
      SELECT type
      FROM categories
      WHERE id = ? AND is_active = 1
    )
    SELECT
      (SELECT COUNT(*) FROM desired) AS desiredCount,
      (
        SELECT COUNT(*)
        FROM desired
        INNER JOIN transactions AS current
          ON current.id = desired.desired_id
          AND current.updated_at = desired.expected_updated_at
      ) AS currentCount,
      (
        SELECT COUNT(*)
        FROM desired
        INNER JOIN transactions AS current
          ON current.id = desired.desired_id
          AND current.updated_at = desired.expected_updated_at
        INNER JOIN target ON target.type = current.type
      ) AS compatibleCount,
      EXISTS(SELECT 1 FROM target) AS targetActive
  `).bind(desired, input.categoryId)
  const update = database.prepare(`
    WITH
    desired AS (
      SELECT
        json_extract(value, '$.id') AS desired_id,
        json_extract(value, '$.updatedAt') AS expected_updated_at
      FROM json_each(?)
    ),
    target AS (
      SELECT type
      FROM categories
      WHERE id = ? AND is_active = 1
    )
    UPDATE transactions
    SET
      category_id = ?,
      updated_at = CASE
        WHEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') > updated_at
          THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        ELSE strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+0.001 seconds')
      END
    WHERE id IN (SELECT desired_id FROM desired)
      AND EXISTS(SELECT 1 FROM target WHERE target.type = transactions.type)
      AND (SELECT COUNT(*) FROM desired) = (
        SELECT COUNT(*)
        FROM desired
        INNER JOIN transactions AS current
          ON current.id = desired.desired_id
          AND current.updated_at = desired.expected_updated_at
      )
      AND (SELECT COUNT(*) FROM desired) = (
        SELECT COUNT(*)
        FROM desired
        INNER JOIN transactions AS current
          ON current.id = desired.desired_id
          AND current.updated_at = desired.expected_updated_at
        INNER JOIN target ON target.type = current.type
      )
    RETURNING id
  `).bind(desired, input.categoryId, input.categoryId)
  const [guardResult, updateResult] = await database.batch([guard, update])
  const guardRow = guardResult.results[0] as TransactionCategoryGuardRow | undefined
  if (!guardRow) throw new Error('Bulk transaction category guard returned no row')
  if (Number(guardRow.targetActive) !== 1) {
    return { kind: 'reference_invalid', code: 'CATEGORY_INVALID' }
  }
  if (Number(guardRow.currentCount) !== Number(guardRow.desiredCount)) {
    return { kind: 'version_conflict' }
  }
  if (Number(guardRow.compatibleCount) !== Number(guardRow.desiredCount)) {
    return { kind: 'reference_invalid', code: 'CATEGORY_TYPE_MISMATCH' }
  }
  if (updateResult.results.length !== input.transactions.length) {
    throw new Error('Bulk transaction category update did not return every selected row')
  }
  return { kind: 'updated', count: input.transactions.length }
}

export async function setTransactionsImportReviewStatus(
  database: D1Database,
  input: TransactionImportReviewBatchInput,
): Promise<SetTransactionsImportReviewStatusResult> {
  const desired = JSON.stringify(input.transactions)
  const updated = await database.prepare(`
    WITH
    desired AS (
      SELECT
        json_extract(value, '$.id') AS desired_id,
        json_extract(value, '$.updatedAt') AS expected_updated_at
      FROM json_each(?)
    ),
    review_guard AS (
      SELECT
        (SELECT COUNT(*) FROM desired) AS desired_count,
        (
          SELECT COUNT(*)
          FROM desired
          INNER JOIN transactions AS current
            ON current.id = desired.desired_id
            AND current.updated_at = desired.expected_updated_at
            AND current.import_review_status IS NOT NULL
          WHERE EXISTS (
            SELECT 1
            FROM transaction_import_keys
            WHERE transaction_import_keys.transaction_id = current.id
          )
        ) AS matched_count
    )
    UPDATE transactions
    SET
      import_review_status = ?,
      updated_at = CASE
        WHEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') > updated_at
          THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        ELSE strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+0.001 seconds')
      END
    WHERE id IN (SELECT desired_id FROM desired)
      AND (
        SELECT desired_count = matched_count
        FROM review_guard
      )
  `).bind(desired, input.status).run()

  return Number(updated.meta.changes) > 0
    ? { kind: 'updated', count: input.transactions.length }
    : { kind: 'version_conflict' }
}

export async function deleteTransaction(
  database: D1Database,
  id: string,
  updatedAt: string,
): Promise<DeleteTransactionResult> {
  const deleted = await database.prepare('DELETE FROM transactions WHERE id = ? AND updated_at = ?')
    .bind(id, updatedAt)
    .run()

  if (Number(deleted.meta.changes) === 0) {
    const existing = await getTransaction(database, id)
    return existing ? { kind: 'version_conflict' } : { kind: 'not_found' }
  }
  return { kind: 'deleted', id }
}

export async function getSummary(
  database: D1Database,
  month: string,
  now = new Date(),
): Promise<Summary> {
  const { start, end } = monthRangeDates(month)
  const outlookStart = currentHongKongDate(now).date
  const outlookEndDate = new Date(`${outlookStart}T00:00:00.000Z`)
  outlookEndDate.setUTCDate(outlookEndDate.getUTCDate() + 35)
  const outlookEnd = outlookEndDate.toISOString().slice(0, 10)
  const recurringQueryEnd = end > outlookEnd ? end : outlookEnd
  const previousStart = `${shiftMonth(month, -1)}-01`
  const trendStart = `${shiftMonth(month, -5)}-01`
  const [
    row,
    cashFlowTrendResult,
    incomeByCategoryResult,
    expenseByCategoryResult,
    expenseByPayeeResult,
    monthlySpendingPlansResult,
    recurringRulesResult,
    recurringTransferRulesResult,
  ] = await Promise.all([
    database.prepare(`
      SELECT
        TOTAL(CASE WHEN type = 'income' THEN amount_minor ELSE 0 END) AS income,
        TOTAL(CASE WHEN type = 'expense' THEN amount_minor ELSE 0 END) AS expense
      FROM transactions
      WHERE occurred_on >= ? AND occurred_on < ?
    `)
      .bind(start, end)
      .first<SummaryRow>(),
    database.prepare(`
      SELECT
        substr(occurred_on, 1, 7) AS month,
        TOTAL(CASE WHEN type = 'income' THEN amount_minor ELSE 0 END) AS incomeMinor,
        TOTAL(CASE WHEN type = 'expense' THEN amount_minor ELSE 0 END) AS expenseMinor,
        COUNT(*) AS transactionCount,
        SUM(CASE WHEN type = 'expense' THEN 1 ELSE 0 END) AS expenseTransactionCount
      FROM transactions
      WHERE occurred_on >= ? AND occurred_on < ?
      GROUP BY month
      ORDER BY month ASC
    `)
      .bind(trendStart, end)
      .all<MonthlyCashFlowQueryRow>(),
    database.prepare(`
      SELECT
        category.id AS categoryId,
        category.name AS categoryName,
        category.localization_key AS categoryLocalizationKey,
        category.icon AS categoryIcon,
        category.color AS categoryColor,
        TOTAL(t.amount_minor) AS amountMinor,
        COUNT(*) AS transactionCount
      FROM transactions t
      INNER JOIN categories category ON category.id = t.category_id
      WHERE t.type = 'income' AND t.occurred_on >= ? AND t.occurred_on < ?
      GROUP BY
        category.id,
        category.name,
        category.localization_key,
        category.icon,
        category.color,
        category.sort_order
      ORDER BY amountMinor DESC, category.sort_order ASC, category.id ASC
    `)
      .bind(start, end)
      .all<ExpenseCategorySummary>(),
    database.prepare(`
      SELECT
        category.id AS categoryId,
        category.name AS categoryName,
        category.localization_key AS categoryLocalizationKey,
        category.icon AS categoryIcon,
        category.color AS categoryColor,
        TOTAL(CASE WHEN t.occurred_on >= ? THEN t.amount_minor ELSE 0 END) AS amountMinor,
        SUM(CASE WHEN t.occurred_on >= ? THEN 1 ELSE 0 END) AS transactionCount,
        TOTAL(CASE WHEN t.occurred_on < ? THEN t.amount_minor ELSE 0 END) AS previousMonthAmountMinor
      FROM transactions t
      INNER JOIN categories category ON category.id = t.category_id
      WHERE t.type = 'expense' AND t.occurred_on >= ? AND t.occurred_on < ?
      GROUP BY
        category.id,
        category.name,
        category.localization_key,
        category.icon,
        category.color,
        category.sort_order
      HAVING SUM(CASE WHEN t.occurred_on >= ? THEN 1 ELSE 0 END) > 0
      ORDER BY amountMinor DESC, category.sort_order ASC, category.id ASC
    `)
      .bind(start, start, start, previousStart, end, start)
      .all<ExpenseCategoryQueryRow>(),
    database.prepare(`
      SELECT
        MIN(trim(payee)) AS payee,
        TOTAL(amount_minor) AS amountMinor,
        COUNT(*) AS transactionCount
      FROM transactions
      WHERE type = 'expense'
        AND occurred_on >= ?
        AND occurred_on < ?
        AND trim(payee) <> ''
      GROUP BY trim(payee)
      ORDER BY amountMinor DESC, lower(payee) ASC
    `)
      .bind(start, end)
      .all<ExpensePayeeSummary>(),
    database.prepare(`
      SELECT
        category.id AS categoryId,
        category.name AS categoryName,
        category.localization_key AS categoryLocalizationKey,
        category.icon AS categoryIcon,
        category.color AS categoryColor,
        category.monthly_plan_minor AS plannedMinor,
        TOTAL(t.amount_minor) AS spentMinor
      FROM categories category
      LEFT JOIN transactions t
        ON t.category_id = category.id
        AND t.type = 'expense'
        AND t.occurred_on >= ?
        AND t.occurred_on < ?
      WHERE category.type = 'expense'
        AND category.monthly_plan_minor IS NOT NULL
      GROUP BY
        category.id,
        category.name,
        category.localization_key,
        category.icon,
        category.color,
        category.monthly_plan_minor,
        category.is_active,
        category.sort_order
      HAVING category.is_active = 1 OR COUNT(t.id) > 0
      ORDER BY category.sort_order ASC, category.id ASC
    `)
      .bind(start, end)
      .all<MonthlySpendingPlanSummary>(),
    database.prepare(`
      SELECT
        id,
        name,
        type,
        amount_minor AS amountMinor,
        payee,
        account_id AS accountId,
        category_id AS categoryId,
        frequency,
        next_occurrence_on AS nextOccurrenceOn,
        anchor_day AS anchorDay,
        schedule_ends_on AS scheduleEndsOn
      FROM recurring_rules
      WHERE is_active = 1
        AND deleted_at IS NULL
        AND next_occurrence_on < ?
        AND (schedule_ends_on IS NULL OR next_occurrence_on <= schedule_ends_on)
      ORDER BY next_occurrence_on ASC, id ASC
    `)
      .bind(recurringQueryEnd)
      .all<RecurringForecastRule>(),
    database.prepare(`
      SELECT
        r.id,
        r.name,
        r.amount_minor AS amountMinor,
        r.from_account_id AS fromAccountId,
        source.name AS fromAccountName,
        source.localization_key AS fromAccountLocalizationKey,
        r.to_account_id AS toAccountId,
        destination.name AS toAccountName,
        destination.localization_key AS toAccountLocalizationKey,
        r.frequency,
        r.next_occurrence_on AS nextOccurrenceOn,
        r.anchor_day AS anchorDay,
        r.schedule_ends_on AS scheduleEndsOn
      FROM recurring_transfer_rules r
      INNER JOIN accounts source ON source.id = r.from_account_id
      INNER JOIN accounts destination ON destination.id = r.to_account_id
      WHERE r.is_active = 1
        AND r.deleted_at IS NULL
        AND r.next_occurrence_on < ?
        AND (r.schedule_ends_on IS NULL OR r.next_occurrence_on <= r.schedule_ends_on)
      ORDER BY r.next_occurrence_on ASC, r.id ASC
    `)
      .bind(recurringQueryEnd)
      .all<RecurringTransferForecastRule>(),
  ])

  if (!row) throw new Error('Monthly summary aggregate is missing')
  const totals = exactTransactionTotals([
    { type: 'income', amountMinor: row.income },
    { type: 'expense', amountMinor: row.expense },
  ])
  const cashFlowTrend = buildMonthlyCashFlowTrend(month, cashFlowTrendResult.results)
  const incomeByCategory = normalizeIncomeCategoryRows(
    incomeByCategoryResult.results,
    totals.income,
  )
  return {
    month,
    income: totals.income,
    expense: totals.expense,
    balance: totals.net,
    cashFlowTrend,
    spendingTrend: buildMonthlySpendingTrend(
      month,
      buildLegacySpendingTrendRows(cashFlowTrendResult.results),
    ),
    incomeByCategory,
    expenseByCategory: normalizeExpenseCategoryRows(expenseByCategoryResult.results),
    expenseByPayee: mergePayeeSummaries(expenseByPayeeResult.results),
    monthlySpendingPlans: monthlySpendingPlansResult.results,
    recurringForecast: recurringForecastForMonth(recurringRulesResult.results, month),
    recurringTransferForecast: recurringTransferForecastForMonth(
      recurringTransferRulesResult.results,
      month,
    ),
    scheduledOutlook: {
      startOn: outlookStart,
      endOnExclusive: outlookEnd,
      recurringForecast: recurringForecastForRange(
        recurringRulesResult.results,
        outlookStart,
        outlookEnd,
      ),
      recurringTransferForecast: recurringTransferForecastForRange(
        recurringTransferRulesResult.results,
        outlookStart,
        outlookEnd,
      ),
    },
  }
}

function validateCategoryRows(
  rows: ExpenseCategorySummary[],
  type: TransactionType,
  label: string,
) {
  let transactionCount = 0n
  for (const row of rows) {
    if (!Number.isSafeInteger(row.categoryId) || row.categoryId <= 0) {
      throw new Error(`${label} category ID must be a positive safe integer`)
    }
    if (!Number.isSafeInteger(row.transactionCount) || row.transactionCount <= 0) {
      throw new Error(`${label} transaction count must be a positive safe integer`)
    }
    transactionCount += BigInt(row.transactionCount)
  }
  if (transactionCount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} transaction count exceeds the safe integer range`)
  }

  return exactTransactionTotals(rows.map(({ amountMinor }) => ({ type, amountMinor })))
}

function normalizeIncomeCategoryRows(
  rows: ExpenseCategorySummary[],
  expectedIncome: number,
): ExpenseCategorySummary[] {
  const totals = validateCategoryRows(rows, 'income', 'Category income')
  if (totals.income !== expectedIncome) {
    throw new Error('Category income does not match the monthly income total')
  }
  return rows
}

function normalizeExpenseCategoryRows(rows: ExpenseCategoryQueryRow[]): ExpenseCategorySummary[] {
  validateCategoryRows(rows, 'expense', 'Category spending')

  return rows.map((row) => ({
    ...row,
    previousMonthAmountMinor:
      Number.isSafeInteger(row.previousMonthAmountMinor) && row.previousMonthAmountMinor >= 0
        ? row.previousMonthAmountMinor
        : null,
  }))
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, '\\$&')
}

export async function getTransaction(database: D1Database, id: string) {
  const row = await database
    .prepare(`${transactionSelect} WHERE t.id = ? LIMIT 1`)
    .bind(id)
    .first<TransactionRow>()
  return row ? transactionView(row) : null
}

function transactionView(row: TransactionRow): TransactionView {
  const { payeeBlank, ...transaction } = row
  if (payeeBlank !== 0 && payeeBlank !== 1) {
    throw new Error('Transaction payee sort rank is invalid')
  }
  return { ...transaction, cleared: row.cleared === 1 }
}

function matchesInput(transaction: TransactionView, input: TransactionInput) {
  return (
    transaction.id === input.id &&
    transaction.type === input.type &&
    transaction.amountMinor === input.amountMinor &&
    transaction.currency === input.currency &&
    transaction.accountId === input.accountId &&
    transaction.categoryId === input.categoryId &&
    transaction.occurredOn === input.occurredOn &&
    transaction.cleared === input.cleared &&
    transaction.payee === input.payee &&
    transaction.note === input.note
  )
}

async function validateReferences(
  database: D1Database,
  input: Pick<TransactionInput, 'accountId' | 'categoryId' | 'currency' | 'type'>,
  allowInactive?: { accountId: number; categoryId: number },
): Promise<ReferenceErrorCode | null> {
  const [account, category] = await Promise.all([
    database.prepare(`
      SELECT id, is_active AS isActive, currency
      FROM accounts
      WHERE id = ?
    `)
      .bind(input.accountId)
      .first<ReferenceRow>(),
    database.prepare(`
      SELECT id, is_active AS isActive, type
      FROM categories
      WHERE id = ?
    `)
      .bind(input.categoryId)
      .first<ReferenceRow>(),
  ])

  if (
    !account
    || account.currency !== input.currency
    || (account.isActive !== 1 && account.id !== allowInactive?.accountId)
  ) {
    return 'ACCOUNT_INVALID'
  }
  if (!category || (category.isActive !== 1 && category.id !== allowInactive?.categoryId)) {
    return 'CATEGORY_INVALID'
  }
  if (category.type !== input.type) return 'CATEGORY_TYPE_MISMATCH'
  return null
}
