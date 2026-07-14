import 'server-only'

import type {
  Account,
  AccountCreateInput,
  AccountUpdateInput,
  Category,
  CategoryCreateInput,
  CategoryUpdateInput,
  ReferenceOrderInput,
  ReferenceStatusInput,
  TransactionType,
} from '../lib/schema'

type AccountRow = Omit<Account, 'isActive'> & { isActive: number }
type CategoryRow = Omit<Category, 'isActive'> & { isActive: number }

export type ReferenceMutationResult<T> =
  | { kind: 'created' | 'updated'; item: T }
  | {
      kind:
        | 'not_found'
        | 'version_conflict'
        | 'name_conflict'
        | 'last_active'
        | 'active_rules'
        | 'emergency_fund_goal'
        | 'currency_conflict'
    }

export type ReferenceOrderResult<T> =
  | { kind: 'updated'; items: T[] }
  | { kind: 'version_conflict' }

const accountSelect = `
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
`

const categorySelect = `
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
`

const nextUpdatedAt = `
  CASE
    WHEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') > updated_at
      THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    ELSE strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+0.001 seconds')
  END
`

const desiredOrder = `
  SELECT
    CAST(json_extract(value, '$.id') AS INTEGER) AS desired_id,
    json_extract(value, '$.updatedAt') AS expected_updated_at,
    CAST(key AS INTEGER) AS position
  FROM json_each(?)
`

const accountOrderUpdate = `
  WITH
  desired AS (${desiredOrder}),
  scope AS (
    SELECT account.is_active AS is_active
    FROM accounts AS account
    INNER JOIN desired ON desired.desired_id = account.id
    ORDER BY desired.position
    LIMIT 1
  ),
  order_guard AS (
    SELECT
      (SELECT COUNT(*) FROM desired) AS desired_count,
      (
        SELECT COUNT(*)
        FROM desired
        INNER JOIN accounts AS account ON account.id = desired.desired_id
        WHERE account.updated_at = desired.expected_updated_at
          AND account.is_active = (SELECT is_active FROM scope)
      ) AS matched_count,
      (
        SELECT COUNT(*)
        FROM accounts
        WHERE is_active = (SELECT is_active FROM scope)
      ) AS scope_count
  )
  UPDATE accounts
  SET
    sort_order = (
      SELECT (desired.position + 1) * 10
      FROM desired
      WHERE desired.desired_id = accounts.id
    ),
    updated_at = ${nextUpdatedAt}
  WHERE id IN (SELECT desired_id FROM desired)
    AND (
      SELECT desired_count = matched_count AND desired_count = scope_count
      FROM order_guard
    )
`

const categoryOrderUpdate = `
  WITH
  desired AS (${desiredOrder}),
  scope AS (
    SELECT category.type AS type, category.is_active AS is_active
    FROM categories AS category
    INNER JOIN desired ON desired.desired_id = category.id
    ORDER BY desired.position
    LIMIT 1
  ),
  order_guard AS (
    SELECT
      (SELECT COUNT(*) FROM desired) AS desired_count,
      (
        SELECT COUNT(*)
        FROM desired
        INNER JOIN categories AS category ON category.id = desired.desired_id
        WHERE category.updated_at = desired.expected_updated_at
          AND category.type = (SELECT type FROM scope)
          AND category.is_active = (SELECT is_active FROM scope)
      ) AS matched_count,
      (
        SELECT COUNT(*)
        FROM categories
        WHERE type = (SELECT type FROM scope)
          AND is_active = (SELECT is_active FROM scope)
      ) AS scope_count
  )
  UPDATE categories
  SET
    sort_order = (
      SELECT (desired.position + 1) * 10
      FROM desired
      WHERE desired.desired_id = categories.id
    ),
    updated_at = ${nextUpdatedAt}
  WHERE id IN (SELECT desired_id FROM desired)
    AND (
      SELECT desired_count = matched_count AND desired_count = scope_count
      FROM order_guard
    )
`

export async function getAccountReference(database: D1Database, id: number) {
  const row = await database
    .prepare(`${accountSelect} WHERE id = ? LIMIT 1`)
    .bind(id)
    .first<AccountRow>()
  return row ? accountFromRow(row) : null
}

export async function getCategoryReference(database: D1Database, id: number) {
  const row = await database
    .prepare(`${categorySelect} WHERE id = ? LIMIT 1`)
    .bind(id)
    .first<CategoryRow>()
  return row ? categoryFromRow(row) : null
}

export async function createAccountReference(
  database: D1Database,
  input: AccountCreateInput,
): Promise<ReferenceMutationResult<Account>> {
  const inserted = await database.prepare(`
    INSERT OR IGNORE INTO accounts(
      name, type, currency, is_active, sort_order, localization_key,
      opening_balance_minor, opening_balance_on
    )
    SELECT
      ?,
      ?,
      settings.currency,
      1,
      COALESCE((SELECT MAX(sort_order) + 10 FROM accounts), 10),
      NULL,
      ?,
      ?
    FROM ledger_settings AS settings
    WHERE settings.id = 1
      AND settings.currency = ?
      AND NOT EXISTS (
      SELECT 1 FROM accounts WHERE name = ? COLLATE NOCASE
    )
  `).bind(
    input.name,
    input.type,
    input.openingBalanceMinor,
    input.openingBalanceOn,
    input.expectedCurrency,
    input.name,
  ).run()

  if (Number(inserted.meta.changes) === 0) {
    return await ledgerCurrencyMatches(database, input.expectedCurrency)
      ? { kind: 'name_conflict' }
      : { kind: 'currency_conflict' }
  }
  const item = await getAccountByName(database, input.name)
  if (!item) throw new Error('Account insert did not produce a row')
  return { kind: 'created', item }
}

export async function updateAccountReference(
  database: D1Database,
  id: number,
  input: AccountUpdateInput,
): Promise<ReferenceMutationResult<Account>> {
  const updated = await database.prepare(`
    UPDATE OR IGNORE accounts
    SET
      name = ?,
      type = ?,
      opening_balance_minor = ?,
      opening_balance_on = ?,
      localization_key = CASE WHEN name = ? THEN localization_key ELSE NULL END,
      updated_at = ${nextUpdatedAt}
    WHERE id = ? AND updated_at = ?
      AND EXISTS (
        SELECT 1 FROM ledger_settings WHERE id = 1 AND currency = ?
      )
      AND NOT EXISTS (
        SELECT 1
        FROM accounts AS other
        WHERE other.name = ? COLLATE NOCASE AND other.id <> ?
      )
      AND (? <> 'credit_card' OR NOT EXISTS (
        SELECT 1 FROM emergency_fund_goals WHERE account_id = ?
      ))
  `).bind(
    input.name,
    input.type,
    input.openingBalanceMinor,
    input.openingBalanceOn,
    input.name,
    id,
    input.updatedAt,
    input.expectedCurrency,
    input.name,
    id,
    input.type,
    id,
  ).run()

  if (Number(updated.meta.changes) === 0) {
    return diagnoseAccountMutation(
      database,
      id,
      input.updatedAt,
      input.name,
      input.type,
      input.expectedCurrency,
    )
  }

  const item = await getAccountReference(database, id)
  if (!item) throw new Error('Account update did not produce a row')
  return { kind: 'updated', item }
}

export async function setAccountReferenceStatus(
  database: D1Database,
  id: number,
  input: ReferenceStatusInput,
): Promise<ReferenceMutationResult<Account>> {
  const existing = await getAccountReference(database, id)
  if (!existing) return { kind: 'not_found' }
  if (existing.updatedAt !== input.updatedAt) return { kind: 'version_conflict' }
  if (existing.isActive === input.isActive) return { kind: 'updated', item: existing }

  const active = input.isActive ? 1 : 0
  const updated = await database.prepare(`
    UPDATE accounts
    SET
      is_active = ?,
      updated_at = ${nextUpdatedAt}
    WHERE id = ?
      AND updated_at = ?
      AND (? = 1 OR (SELECT COUNT(*) FROM accounts WHERE is_active = 1) > 1)
      AND (? = 1 OR NOT EXISTS (
        SELECT 1
        FROM recurring_rules
        WHERE account_id = ?
          AND is_active = 1
          AND deleted_at IS NULL
          AND (schedule_ends_on IS NULL OR next_occurrence_on <= schedule_ends_on)
      ))
      AND (? = 1 OR NOT EXISTS (
        SELECT 1
        FROM recurring_transfer_rules
        WHERE (from_account_id = ? OR to_account_id = ?)
          AND is_active = 1
          AND deleted_at IS NULL
          AND (schedule_ends_on IS NULL OR next_occurrence_on <= schedule_ends_on)
      ))
      AND (? = 1 OR NOT EXISTS (
        SELECT 1 FROM emergency_fund_goals WHERE account_id = ?
      ))
  `).bind(
    active,
    id,
    input.updatedAt,
    active,
    active,
    id,
    active,
    id,
    id,
    active,
    id,
  ).run()

  if (Number(updated.meta.changes) === 0) {
    return diagnoseAccountStatus(database, id, input.updatedAt)
  }

  const item = await getAccountReference(database, id)
  if (!item) throw new Error('Account status update did not produce a row')
  return { kind: 'updated', item }
}

export async function createCategoryReference(
  database: D1Database,
  input: CategoryCreateInput,
): Promise<ReferenceMutationResult<Category>> {
  const presentation = categoryPresentation(input.type)
  const inserted = await database.prepare(`
    INSERT OR IGNORE INTO categories(
      name,
      type,
      icon,
      color,
      is_active,
      sort_order,
      localization_key,
      monthly_plan_minor
    )
    SELECT
      ?,
      ?,
      ?,
      ?,
      1,
      COALESCE((SELECT MAX(sort_order) + 10 FROM categories WHERE type = ?), 10),
      NULL,
      ?
    FROM ledger_settings AS settings
    WHERE settings.id = 1
      AND settings.currency = ?
      AND NOT EXISTS (
      SELECT 1 FROM categories WHERE name = ? COLLATE NOCASE AND type = ?
    )
  `).bind(
    input.name,
    input.type,
    presentation.icon,
    presentation.color,
    input.type,
    input.monthlyPlanMinor,
    input.expectedCurrency,
    input.name,
    input.type,
  ).run()

  if (Number(inserted.meta.changes) === 0) {
    return await ledgerCurrencyMatches(database, input.expectedCurrency)
      ? { kind: 'name_conflict' }
      : { kind: 'currency_conflict' }
  }
  const item = await getCategoryByName(database, input.name, input.type)
  if (!item) throw new Error('Category insert did not produce a row')
  return { kind: 'created', item }
}

export async function updateCategoryReference(
  database: D1Database,
  id: number,
  input: CategoryUpdateInput,
): Promise<ReferenceMutationResult<Category>> {
  const updated = await database.prepare(`
    UPDATE OR IGNORE categories
    SET
      name = ?,
      monthly_plan_minor = ?,
      localization_key = CASE WHEN name = ? THEN localization_key ELSE NULL END,
      updated_at = ${nextUpdatedAt}
    WHERE id = ? AND updated_at = ? AND type = ?
      AND EXISTS (
        SELECT 1 FROM ledger_settings WHERE id = 1 AND currency = ?
      )
      AND NOT EXISTS (
        SELECT 1
        FROM categories AS other
        WHERE other.name = ? COLLATE NOCASE
          AND other.type = categories.type
          AND other.id <> ?
      )
  `).bind(
    input.name,
    input.monthlyPlanMinor,
    input.name,
    id,
    input.updatedAt,
    input.type,
    input.expectedCurrency,
    input.name,
    id,
  ).run()

  if (Number(updated.meta.changes) === 0) {
    return diagnoseCategoryMutation(
      database,
      id,
      input.updatedAt,
      input.name,
      input.expectedCurrency,
    )
  }

  const item = await getCategoryReference(database, id)
  if (!item) throw new Error('Category update did not produce a row')
  return { kind: 'updated', item }
}

export async function setCategoryReferenceStatus(
  database: D1Database,
  id: number,
  input: ReferenceStatusInput,
): Promise<ReferenceMutationResult<Category>> {
  const existing = await getCategoryReference(database, id)
  if (!existing) return { kind: 'not_found' }
  if (existing.updatedAt !== input.updatedAt) return { kind: 'version_conflict' }
  if (existing.isActive === input.isActive) return { kind: 'updated', item: existing }

  const active = input.isActive ? 1 : 0
  const updated = await database.prepare(`
    UPDATE categories
    SET
      is_active = ?,
      updated_at = ${nextUpdatedAt}
    WHERE id = ?
      AND updated_at = ?
      AND (? = 1 OR (
        SELECT COUNT(*)
        FROM categories
        WHERE is_active = 1 AND type = ?
      ) > 1)
      AND (? = 1 OR NOT EXISTS (
        SELECT 1
        FROM recurring_rules
        WHERE category_id = ?
          AND is_active = 1
          AND deleted_at IS NULL
          AND (schedule_ends_on IS NULL OR next_occurrence_on <= schedule_ends_on)
      ))
  `).bind(active, id, input.updatedAt, active, existing.type, active, id).run()

  if (Number(updated.meta.changes) === 0) {
    return diagnoseCategoryStatus(database, id, input.updatedAt, existing.type)
  }

  const item = await getCategoryReference(database, id)
  if (!item) throw new Error('Category status update did not produce a row')
  return { kind: 'updated', item }
}

export async function reorderAccountReferences(
  database: D1Database,
  input: ReferenceOrderInput,
): Promise<ReferenceOrderResult<Account>> {
  const desired = JSON.stringify(input.items)
  const updated = await database.prepare(accountOrderUpdate).bind(desired).run()
  if (Number(updated.meta.changes) === 0) return { kind: 'version_conflict' }

  return { kind: 'updated', items: await orderedAccounts(database, desired) }
}

export async function reorderCategoryReferences(
  database: D1Database,
  input: ReferenceOrderInput,
): Promise<ReferenceOrderResult<Category>> {
  const desired = JSON.stringify(input.items)
  const updated = await database.prepare(categoryOrderUpdate).bind(desired).run()
  if (Number(updated.meta.changes) === 0) return { kind: 'version_conflict' }

  return { kind: 'updated', items: await orderedCategories(database, desired) }
}

async function diagnoseAccountMutation(
  database: D1Database,
  id: number,
  updatedAt: string,
  name: string,
  type: Account['type'],
  expectedCurrency: Account['currency'],
): Promise<ReferenceMutationResult<Account>> {
  const existing = await getAccountReference(database, id)
  if (!existing) return { kind: 'not_found' }
  if (existing.updatedAt !== updatedAt) return { kind: 'version_conflict' }
  if (!await ledgerCurrencyMatches(database, expectedCurrency)) {
    return { kind: 'currency_conflict' }
  }
  if (type === 'credit_card' && await hasEmergencyFundGoal(database, id)) {
    return { kind: 'emergency_fund_goal' }
  }
  return (await accountNameIsTaken(database, name, id))
    ? { kind: 'name_conflict' }
    : { kind: 'version_conflict' }
}

async function diagnoseCategoryMutation(
  database: D1Database,
  id: number,
  updatedAt: string,
  name: string,
  expectedCurrency: Account['currency'],
): Promise<ReferenceMutationResult<Category>> {
  const existing = await getCategoryReference(database, id)
  if (!existing) return { kind: 'not_found' }
  if (existing.updatedAt !== updatedAt) return { kind: 'version_conflict' }
  if (!await ledgerCurrencyMatches(database, expectedCurrency)) {
    return { kind: 'currency_conflict' }
  }
  return (await categoryNameIsTaken(database, name, existing.type, id))
    ? { kind: 'name_conflict' }
    : { kind: 'version_conflict' }
}

async function diagnoseAccountStatus(
  database: D1Database,
  id: number,
  updatedAt: string,
): Promise<ReferenceMutationResult<Account>> {
  const existing = await getAccountReference(database, id)
  if (!existing) return { kind: 'not_found' }
  if (existing.updatedAt !== updatedAt) return { kind: 'version_conflict' }
  if (await hasActiveRules(database, 'account_id', id)) return { kind: 'active_rules' }
  if (await hasActiveTransferRules(database, id)) return { kind: 'active_rules' }
  if (await hasEmergencyFundGoal(database, id)) return { kind: 'emergency_fund_goal' }
  const active = await database.prepare('SELECT COUNT(*) AS count FROM accounts WHERE is_active = 1')
    .first<{ count: number }>()
  return (active?.count ?? 0) <= 1 ? { kind: 'last_active' } : { kind: 'version_conflict' }
}

async function diagnoseCategoryStatus(
  database: D1Database,
  id: number,
  updatedAt: string,
  type: TransactionType,
): Promise<ReferenceMutationResult<Category>> {
  const existing = await getCategoryReference(database, id)
  if (!existing) return { kind: 'not_found' }
  if (existing.updatedAt !== updatedAt) return { kind: 'version_conflict' }
  if (await hasActiveRules(database, 'category_id', id)) return { kind: 'active_rules' }
  const active = await database.prepare(`
    SELECT COUNT(*) AS count
    FROM categories
    WHERE is_active = 1 AND type = ?
  `).bind(type).first<{ count: number }>()
  return (active?.count ?? 0) <= 1 ? { kind: 'last_active' } : { kind: 'version_conflict' }
}

async function hasActiveRules(database: D1Database, column: 'account_id' | 'category_id', id: number) {
  const row = await database.prepare(`
    SELECT 1 AS found
    FROM recurring_rules
    WHERE ${column} = ?
      AND is_active = 1
      AND deleted_at IS NULL
      AND (schedule_ends_on IS NULL OR next_occurrence_on <= schedule_ends_on)
    LIMIT 1
  `).bind(id).first<{ found: number }>()
  return row?.found === 1
}

async function hasActiveTransferRules(database: D1Database, accountId: number) {
  const row = await database.prepare(`
    SELECT 1 AS found
    FROM recurring_transfer_rules
    WHERE (from_account_id = ? OR to_account_id = ?)
      AND is_active = 1
      AND deleted_at IS NULL
      AND (schedule_ends_on IS NULL OR next_occurrence_on <= schedule_ends_on)
    LIMIT 1
  `).bind(accountId, accountId).first<{ found: number }>()
  return row?.found === 1
}

async function hasEmergencyFundGoal(database: D1Database, accountId: number) {
  const row = await database.prepare(`
    SELECT 1 AS found
    FROM emergency_fund_goals
    WHERE account_id = ?
    LIMIT 1
  `).bind(accountId).first<{ found: number }>()
  return row?.found === 1
}

async function ledgerCurrencyMatches(database: D1Database, expectedCurrency: Account['currency']) {
  const row = await database.prepare(`
    SELECT 1 AS found
    FROM ledger_settings
    WHERE id = 1 AND currency = ?
    LIMIT 1
  `).bind(expectedCurrency).first<{ found: number }>()
  return row?.found === 1
}

async function getAccountByName(database: D1Database, name: string) {
  const row = await database.prepare(`${accountSelect} WHERE name = ? COLLATE NOCASE LIMIT 1`)
    .bind(name)
    .first<AccountRow>()
  return row ? accountFromRow(row) : null
}

async function getCategoryByName(database: D1Database, name: string, type: TransactionType) {
  const row = await database.prepare(`
    ${categorySelect}
    WHERE name = ? COLLATE NOCASE AND type = ?
    LIMIT 1
  `).bind(name, type).first<CategoryRow>()
  return row ? categoryFromRow(row) : null
}

async function orderedAccounts(database: D1Database, desired: string) {
  const result = await database.prepare(`
    WITH desired AS (${desiredOrder})
    ${accountSelect}
    INNER JOIN desired ON desired.desired_id = accounts.id
    ORDER BY desired.position
  `).bind(desired).all<AccountRow>()
  return result.results.map(accountFromRow)
}

async function orderedCategories(database: D1Database, desired: string) {
  const result = await database.prepare(`
    WITH desired AS (${desiredOrder})
    ${categorySelect}
    INNER JOIN desired ON desired.desired_id = categories.id
    ORDER BY desired.position
  `).bind(desired).all<CategoryRow>()
  return result.results.map(categoryFromRow)
}

async function accountNameIsTaken(database: D1Database, name: string, id: number) {
  const row = await database.prepare(`
    SELECT 1 AS found
    FROM accounts
    WHERE name = ? COLLATE NOCASE AND id <> ?
    LIMIT 1
  `).bind(name, id).first<{ found: number }>()
  return row?.found === 1
}

async function categoryNameIsTaken(
  database: D1Database,
  name: string,
  type: TransactionType,
  id: number,
) {
  const row = await database.prepare(`
    SELECT 1 AS found
    FROM categories
    WHERE name = ? COLLATE NOCASE AND type = ? AND id <> ?
    LIMIT 1
  `).bind(name, type, id).first<{ found: number }>()
  return row?.found === 1
}

function accountFromRow(row: AccountRow): Account {
  return { ...row, isActive: row.isActive === 1 }
}

function categoryFromRow(row: CategoryRow): Category {
  return { ...row, isActive: row.isActive === 1 }
}

function categoryPresentation(type: TransactionType) {
  return type === 'income'
    ? { icon: 'circle-dollar-sign', color: '#2F766D' }
    : { icon: 'circle-ellipsis', color: '#64748B' }
}
