import 'server-only'

import { monthRangeDates, shiftMonth } from '../lib/date'
import { buildNetWorthTrend, netWorthTrendMonths } from '../lib/netWorthTrend'
import {
  recurringForecastForMonth,
  type RecurringForecastRule,
} from '../lib/recurringForecast'
import { buildMonthlySpendingTrend } from '../lib/spendingTrend'
import type {
  Account,
  AccountBalance,
  AccountLocalizationKey,
  Category,
  CategoryLocalizationKey,
  ExpenseCategorySummary,
  MonthlySpendingSummary,
  MonthlySpendingPlanSummary,
  NetWorthTrendPoint,
  PayeeSuggestion,
  Summary,
  Transaction,
  TransactionClearingStatus,
  TransactionFilterSummary,
  TransactionInput,
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
  currency: 'HKD'
  accountId: number
  categoryId: number
  occurredOn: string
  cleared: number
  payee: string
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

type TransactionFilterSummaryRow = Omit<TransactionFilterSummary, 'net'>

export type TransactionView = Omit<Transaction, 'recurringRuleId' | 'recurringRuleName'> & {
  recurringRuleId: string | null
  recurringRuleName: string | null
  recurrenceDueOn: string | null
}

export type TransactionQuery = {
  month: string
  type?: TransactionType
  accountId?: number
  categoryId?: number
  search?: string
  tag?: string
  status?: TransactionClearingStatus
  sort?: TransactionSort
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

type AccountBalanceRow = Omit<AccountBalance, 'isActive'> & { isActive: number }
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
        END AS clearedAmount
      FROM transactions
      WHERE occurred_on < ?

      UNION ALL

      SELECT
        from_account_id AS accountId,
        occurred_on AS occurredOn,
        -amount_minor AS recordedAmount,
        CASE WHEN from_cleared = 1 THEN -amount_minor ELSE 0 END AS clearedAmount
      FROM account_transfers
      WHERE occurred_on < ?

      UNION ALL

      SELECT
        to_account_id AS accountId,
        occurred_on AS occurredOn,
        amount_minor AS recordedAmount,
        CASE WHEN to_cleared = 1 THEN amount_minor ELSE 0 END AS clearedAmount
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
        END), 0) AS clearedMovement
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
        WHEN account.opening_balance_on IS NOT NULL AND account.opening_balance_on > totals.endDate THEN NULL
        ELSE COALESCE(account.opening_balance_minor, 0) + totals.recordedMovement
      END AS recordedBalance,
      CASE
        WHEN account.opening_balance_on IS NOT NULL AND account.opening_balance_on > totals.endDate THEN NULL
        ELSE COALESCE(account.opening_balance_minor, 0) + totals.clearedMovement
      END AS clearedBalance,
      CASE
        WHEN account.opening_balance_on IS NOT NULL AND account.opening_balance_on > totals.endDate THEN NULL
        ELSE totals.recordedMovement - totals.clearedMovement
      END AS unclearedBalance
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
  return selectTransactions(database, query, true)
}

export async function listTransactionsForExport(
  database: D1Database,
  query: TransactionQuery,
): Promise<TransactionView[]> {
  return selectTransactions(database, query, false)
}

function transactionQueryWhere(query: TransactionQuery) {
  const { start, end } = monthRangeDates(query.month)
  const filters = ['t.occurred_on >= ?', 't.occurred_on < ?']
  const values: Array<string | number> = [start, end]

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

  if (query.status) {
    filters.push('t.cleared = ?')
    values.push(query.status === 'cleared' ? 1 : 0)
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

  return { clause: filters.join(' AND '), values }
}

export async function summarizeTransactions(
  database: D1Database,
  query: TransactionQuery,
): Promise<TransactionFilterSummary> {
  const { clause, values } = transactionQueryWhere(query)
  const row = await database.prepare(`
    SELECT
      COUNT(*) AS transactionCount,
      COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount_minor ELSE 0 END), 0) AS income,
      COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount_minor ELSE 0 END), 0) AS expense
    FROM transactions t
    INNER JOIN accounts a ON a.id = t.account_id
    INNER JOIN categories category ON category.id = t.category_id
    WHERE ${clause}
  `)
    .bind(...values)
    .first<TransactionFilterSummaryRow>()

  const transactionCount = row?.transactionCount ?? 0
  const income = row?.income ?? 0
  const expense = row?.expense ?? 0
  return { transactionCount, income, expense, net: income - expense }
}

async function selectTransactions(
  database: D1Database,
  query: TransactionQuery,
  limited: boolean,
): Promise<TransactionView[]> {
  const { clause, values } = transactionQueryWhere(query)
  const orderBy: Record<TransactionSort, string> = {
    date_desc: 't.occurred_on DESC, t.created_at DESC, t.id DESC',
    date_asc: 't.occurred_on ASC, t.created_at ASC, t.id ASC',
    amount_desc: 't.amount_minor DESC, t.occurred_on DESC, t.created_at DESC, t.id DESC',
    amount_asc: 't.amount_minor ASC, t.occurred_on DESC, t.created_at DESC, t.id DESC',
    payee_asc: "(trim(t.payee) = '') ASC, t.payee COLLATE NOCASE ASC, t.occurred_on DESC, t.created_at DESC, t.id DESC",
    payee_desc: "(trim(t.payee) = '') ASC, t.payee COLLATE NOCASE DESC, t.occurred_on DESC, t.created_at DESC, t.id DESC",
  }

  const result = await database.prepare(`
    ${transactionSelect}
    WHERE ${clause}
    ORDER BY ${orderBy[query.sort ?? 'date_desc']}
    ${limited ? 'LIMIT 200' : ''}
  `)
    .bind(...values)
    .all<TransactionRow>()

  return result.results.map(transactionView)
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
    )
    .run()

  const transaction = await getTransaction(database, input.id)
  if (!transaction) {
    const currentReferenceError = await validateReferences(database, input)
    if (currentReferenceError) {
      return { kind: 'reference_invalid', code: currentReferenceError }
    }
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

export async function getSummary(database: D1Database, month: string): Promise<Summary> {
  const { start, end } = monthRangeDates(month)
  const trendStart = `${shiftMonth(month, -5)}-01`
  const [
    row,
    spendingTrendResult,
    expenseByCategoryResult,
    monthlySpendingPlansResult,
    recurringRulesResult,
  ] = await Promise.all([
    database.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'income' THEN amount_minor ELSE 0 END), 0) AS income,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN amount_minor ELSE 0 END), 0) AS expense
      FROM transactions
      WHERE occurred_on >= ? AND occurred_on < ?
    `)
      .bind(start, end)
      .first<SummaryRow>(),
    database.prepare(`
      SELECT
        substr(occurred_on, 1, 7) AS month,
        SUM(amount_minor) AS amountMinor,
        COUNT(*) AS transactionCount
      FROM transactions
      WHERE type = 'expense' AND occurred_on >= ? AND occurred_on < ?
      GROUP BY month
      ORDER BY month ASC
    `)
      .bind(trendStart, end)
      .all<MonthlySpendingSummary>(),
    database.prepare(`
      SELECT
        category.id AS categoryId,
        category.name AS categoryName,
        category.localization_key AS categoryLocalizationKey,
        category.icon AS categoryIcon,
        category.color AS categoryColor,
        SUM(t.amount_minor) AS amountMinor,
        COUNT(*) AS transactionCount
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
        category.monthly_plan_minor AS plannedMinor,
        COALESCE(SUM(t.amount_minor), 0) AS spentMinor
      FROM categories category
      LEFT JOIN transactions t
        ON t.category_id = category.id
        AND t.type = 'expense'
        AND t.occurred_on >= ?
        AND t.occurred_on < ?
      WHERE category.type = 'expense'
        AND category.is_active = 1
        AND category.monthly_plan_minor IS NOT NULL
      GROUP BY
        category.id,
        category.name,
        category.localization_key,
        category.icon,
        category.color,
        category.monthly_plan_minor,
        category.sort_order
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
        frequency,
        next_occurrence_on AS nextOccurrenceOn,
        anchor_day AS anchorDay
      FROM recurring_rules
      WHERE is_active = 1
        AND deleted_at IS NULL
        AND next_occurrence_on < ?
      ORDER BY next_occurrence_on ASC, id ASC
    `)
      .bind(end)
      .all<RecurringForecastRule>(),
  ])

  const income = row?.income ?? 0
  const expense = row?.expense ?? 0
  return {
    month,
    income,
    expense,
    balance: income - expense,
    spendingTrend: buildMonthlySpendingTrend(month, spendingTrendResult.results),
    expenseByCategory: expenseByCategoryResult.results,
    monthlySpendingPlans: monthlySpendingPlansResult.results,
    recurringForecast: recurringForecastForMonth(recurringRulesResult.results, month),
  }
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
  return { ...row, cleared: row.cleared === 1 }
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
