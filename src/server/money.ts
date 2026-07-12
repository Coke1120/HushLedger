import 'server-only'

import { monthRangeDates } from '../lib/date'
import type {
  Account,
  AccountLocalizationKey,
  Category,
  CategoryLocalizationKey,
  Summary,
  Transaction,
  TransactionInput,
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

export type TransactionView = Omit<Transaction, 'recurringRuleId' | 'recurringRuleName'> & {
  recurringRuleId: string | null
  recurringRuleName: string | null
  recurrenceDueOn: string | null
}

export type TransactionQuery = {
  month: string
  type?: TransactionType
  search?: string
}

export type CreateTransactionResult =
  | { kind: 'created' | 'existing'; transaction: TransactionView }
  | { kind: 'id_conflict' }
  | { kind: 'reference_invalid'; code: ReferenceErrorCode }

const transactionSelect = `
  SELECT
    t.id,
    t.type,
    t.amount_minor AS amountMinor,
    t.currency,
    t.account_id AS accountId,
    t.category_id AS categoryId,
    t.occurred_on AS occurredOn,
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
      localization_key AS localizationKey
    FROM accounts
    ORDER BY is_active DESC, sort_order ASC, id ASC
  `).all<AccountRow>()

  return result.results.map((row) => ({ ...row, isActive: row.isActive === 1 }))
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
      localization_key AS localizationKey
    FROM categories
    ORDER BY type DESC, is_active DESC, sort_order ASC, id ASC
  `).all<CategoryRow>()

  return result.results.map((row) => ({ ...row, isActive: row.isActive === 1 }))
}

export async function listTransactions(
  database: D1Database,
  query: TransactionQuery,
): Promise<TransactionView[]> {
  const { start, end } = monthRangeDates(query.month)
  const filters = ['t.occurred_on >= ?', 't.occurred_on < ?']
  const values: string[] = [start, end]

  if (query.type) {
    filters.push('t.type = ?')
    values.push(query.type)
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

  const result = await database.prepare(`
    ${transactionSelect}
    WHERE ${filters.join(' AND ')}
    ORDER BY t.occurred_on DESC, t.created_at DESC, t.id DESC
    LIMIT 200
  `)
    .bind(...values)
    .all<TransactionRow>()

  return result.results
}

export async function createTransaction(
  database: D1Database,
  input: TransactionInput,
): Promise<CreateTransactionResult> {
  const existing = await findTransaction(database, input.id)
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
      payee,
      note
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      input.payee,
      input.note,
    )
    .run()

  const transaction = await findTransaction(database, input.id)
  if (!transaction) throw new Error('Transaction insert did not produce a row')
  if (!matchesInput(transaction, input)) return { kind: 'id_conflict' }

  return {
    kind: Number(inserted.meta.changes) > 0 ? 'created' : 'existing',
    transaction,
  }
}

export async function getSummary(database: D1Database, month: string): Promise<Summary> {
  const { start, end } = monthRangeDates(month)
  const row = await database.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN type = 'income' THEN amount_minor ELSE 0 END), 0) AS income,
      COALESCE(SUM(CASE WHEN type = 'expense' THEN amount_minor ELSE 0 END), 0) AS expense
    FROM transactions
    WHERE occurred_on >= ? AND occurred_on < ?
  `)
    .bind(start, end)
    .first<SummaryRow>()

  const income = row?.income ?? 0
  const expense = row?.expense ?? 0
  return { month, income, expense, balance: income - expense }
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, '\\$&')
}

async function findTransaction(database: D1Database, id: string) {
  return database
    .prepare(`${transactionSelect} WHERE t.id = ? LIMIT 1`)
    .bind(id)
    .first<TransactionRow>() as Promise<TransactionView | null>
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
    transaction.payee === input.payee &&
    transaction.note === input.note
  )
}

async function validateReferences(
  database: D1Database,
  input: TransactionInput,
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

  if (!account || account.isActive !== 1 || account.currency !== input.currency) {
    return 'ACCOUNT_INVALID'
  }
  if (!category || category.isActive !== 1) return 'CATEGORY_INVALID'
  if (category.type !== input.type) return 'CATEGORY_TYPE_MISMATCH'
  return null
}
