import {
  advanceOccurrence,
  firstOccurrenceOnOrAfter,
  recurrenceAnchorDay,
} from '../src/lib/recurrence'
import type {
  RecurrenceFrequency,
  RecurringGenerationResult,
  RecurringRuleCreateInput,
  RecurringRuleUpdateInput,
  TransactionType,
} from '../src/lib/schema'

const GENERATION_CAP = 366
const HKT_OFFSET_MS = 8 * 60 * 60 * 1000

type RuleRow = {
  id: string
  name: string
  type: TransactionType
  amountMinor: number
  currency: 'HKD'
  accountId: number
  categoryId: number
  frequency: RecurrenceFrequency
  scheduleStartsOn: string
  nextOccurrenceOn: string
  lastOccurrenceOn: string | null
  anchorDay: number
  isActive: number
  payee: string
  note: string
  generatedCount: number
  lastErrorCode: string | null
  revision: number
  cursorVersion: number
  deletedAt: string | null
  createdAt: string
  updatedAt: string
  accountName: string | null
  accountIsActive: number | null
  accountCurrency: string | null
  categoryName: string | null
  categoryIsActive: number | null
  categoryType: string | null
}

export type RecurringRuleView = {
  id: string
  name: string
  type: TransactionType
  amountMinor: number
  currency: 'HKD'
  accountId: number
  categoryId: number
  frequency: RecurrenceFrequency
  scheduleStartsOn: string
  nextOccurrenceOn: string
  lastOccurrenceOn: string | null
  anchorDay: number
  isActive: boolean
  payee: string
  note: string
  generatedCount: number
  lastErrorCode: string | null
  revision: number
  accountName: string
  categoryName: string
  createdAt: string
  updatedAt: string
}

export type ReferenceErrorCode =
  | 'ACCOUNT_INVALID'
  | 'CATEGORY_INVALID'
  | 'CATEGORY_TYPE_MISMATCH'

export type CreateRuleResult =
  | { kind: 'created' | 'existing'; rule: RecurringRuleView }
  | { kind: 'id_conflict' }
  | { kind: 'reference_invalid'; code: ReferenceErrorCode }

export type UpdateRuleResult =
  | { kind: 'updated'; rule: RecurringRuleView }
  | { kind: 'not_found' }
  | { kind: 'version_conflict' }
  | { kind: 'reference_invalid'; code: ReferenceErrorCode }

export type DeleteRuleResult =
  | { kind: 'deleted'; id: string; revision: number }
  | { kind: 'not_found' }
  | { kind: 'version_conflict' }

type RuleError = {
  id: string
  revision: number
  cursorVersion: number
  expectedNextOn: string
  code: string
}

type PlannedRule = {
  row: RuleRow
  nextOn: string
  occurrences: string[]
}

type PlannedOccurrence = {
  transactionId: string
  ruleId: string
  revision: number
  cursorVersion: number
  expectedNextOn: string
  dueOn: string
  occurrenceKey: string
}

type PlannedCursorUpdate = {
  ruleId: string
  revision: number
  cursorVersion: number
  expectedNextOn: string
  nextOn: string
}

type PresenceRow = {
  ruleId: string
  occurrenceKey: string
  transactionId: string | null
}

type PlanExecutionResult = {
  created: number
  alreadyExisting: number
  blocked: number
  failed: number
}

const recurringRuleSelect = `
  SELECT
    r.id,
    r.name,
    r.type,
    r.amount_minor AS amountMinor,
    r.currency,
    r.account_id AS accountId,
    r.category_id AS categoryId,
    r.frequency,
    r.schedule_starts_on AS scheduleStartsOn,
    r.next_occurrence_on AS nextOccurrenceOn,
    r.last_occurrence_on AS lastOccurrenceOn,
    r.anchor_day AS anchorDay,
    r.is_active AS isActive,
    r.payee,
    r.note,
    r.generated_count AS generatedCount,
    r.last_error_code AS lastErrorCode,
    r.revision,
    r.cursor_version AS cursorVersion,
    r.deleted_at AS deletedAt,
    r.created_at AS createdAt,
    r.updated_at AS updatedAt,
    a.name AS accountName,
    a.is_active AS accountIsActive,
    a.currency AS accountCurrency,
    category.name AS categoryName,
    category.is_active AS categoryIsActive,
    category.type AS categoryType
  FROM recurring_rules r
  LEFT JOIN accounts a ON a.id = r.account_id
  LEFT JOIN categories category ON category.id = r.category_id
`

export function hktCalendarDate(timestamp = Date.now()) {
  return new Date(timestamp + HKT_OFFSET_MS).toISOString().slice(0, 10)
}

export async function listRecurringRules(database: D1Database) {
  const result = await database
    .prepare(`
      ${recurringRuleSelect}
      WHERE r.deleted_at IS NULL
      ORDER BY r.is_active DESC, r.schedule_starts_on ASC, r.created_at ASC, r.id ASC
    `)
    .all<RuleRow>()

  return result.results.map(toRuleView)
}

export async function getRecurringRule(database: D1Database, id: string) {
  const row = await findRule(database, id, false)
  return row ? toRuleView(row) : null
}

export async function createRecurringRule(
  database: D1Database,
  input: RecurringRuleCreateInput,
  today = hktCalendarDate(),
): Promise<CreateRuleResult> {
  const existing = await findRule(database, input.id, true)
  if (existing) {
    if (existing.deletedAt || !matchesCreateInput(existing, input)) return { kind: 'id_conflict' }
    return { kind: 'existing', rule: toRuleView(existing) }
  }

  const referenceError = await validateReferences(
    database,
    input.accountId,
    input.categoryId,
    input.currency,
    input.type,
  )
  if (referenceError) return { kind: 'reference_invalid', code: referenceError }

  const anchorDay = recurrenceAnchorDay(input.scheduleStartsOn)
  const nextOccurrenceOn = firstOccurrenceOnOrAfter(
    input.scheduleStartsOn,
    today,
    input.frequency,
    anchorDay,
  )
  const inserted = await database
    .prepare(`
      INSERT INTO recurring_rules(
        id,
        name,
        type,
        amount_minor,
        currency,
        account_id,
        category_id,
        frequency,
        schedule_starts_on,
        next_occurrence_on,
        anchor_day,
        is_active,
        payee,
        note
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `)
    .bind(
      input.id,
      input.name,
      input.type,
      input.amountMinor,
      input.currency,
      input.accountId,
      input.categoryId,
      input.frequency,
      input.scheduleStartsOn,
      nextOccurrenceOn,
      anchorDay,
      input.isActive ? 1 : 0,
      input.payee,
      input.note,
    )
    .run()

  const rule = await findRule(database, input.id, true)
  if (!rule) throw new Error('Recurring rule insert did not produce a row')
  if (rule.deletedAt || !matchesCreateInput(rule, input)) return { kind: 'id_conflict' }

  return {
    kind: Number(inserted.meta.changes) > 0 ? 'created' : 'existing',
    rule: toRuleView(rule),
  }
}

export async function updateRecurringRule(
  database: D1Database,
  id: string,
  input: RecurringRuleUpdateInput,
  today = hktCalendarDate(),
): Promise<UpdateRuleResult> {
  const current = await findRule(database, id, true)
  if (!current || current.deletedAt) return { kind: 'not_found' }
  if (current.revision !== input.revision) return { kind: 'version_conflict' }

  const referenceError = await validateReferences(
    database,
    input.accountId,
    input.categoryId,
    input.currency,
    input.type,
  )
  if (referenceError) return { kind: 'reference_invalid', code: referenceError }

  const anchorDay = recurrenceAnchorDay(input.scheduleStartsOn)
  const lowerBound = current.lastOccurrenceOn
    ? [today, advanceOccurrence(current.lastOccurrenceOn, 'daily')].sort().at(-1) ?? today
    : today
  const nextOccurrenceOn = firstOccurrenceOnOrAfter(
    input.scheduleStartsOn,
    lowerBound,
    input.frequency,
    anchorDay,
  )
  const result = await database
    .prepare(`
      UPDATE recurring_rules
      SET
        name = ?,
        type = ?,
        amount_minor = ?,
        currency = ?,
        account_id = ?,
        category_id = ?,
        frequency = ?,
        schedule_starts_on = ?,
        next_occurrence_on = ?,
        anchor_day = ?,
        is_active = ?,
        payee = ?,
        note = ?,
        last_error_code = NULL,
        last_error_at = NULL,
        revision = revision + 1,
        cursor_version = cursor_version + 1,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ? AND revision = ? AND deleted_at IS NULL
    `)
    .bind(
      input.name,
      input.type,
      input.amountMinor,
      input.currency,
      input.accountId,
      input.categoryId,
      input.frequency,
      input.scheduleStartsOn,
      nextOccurrenceOn,
      anchorDay,
      input.isActive ? 1 : 0,
      input.payee,
      input.note,
      id,
      input.revision,
    )
    .run()

  if (Number(result.meta.changes) === 0) return { kind: 'version_conflict' }
  const updated = await findRule(database, id, false)
  if (!updated) throw new Error('Recurring rule update did not produce a row')
  return { kind: 'updated', rule: toRuleView(updated) }
}

export async function setRecurringRuleStatus(
  database: D1Database,
  id: string,
  input: { isActive: boolean; revision: number },
  today = hktCalendarDate(),
): Promise<UpdateRuleResult> {
  const current = await findRule(database, id, true)
  if (!current || current.deletedAt) return { kind: 'not_found' }
  if (current.revision !== input.revision) return { kind: 'version_conflict' }

  let nextOccurrenceOn = current.nextOccurrenceOn
  if (input.isActive && current.isActive !== 1) {
    nextOccurrenceOn = firstOccurrenceOnOrAfter(
      current.nextOccurrenceOn,
      today,
      current.frequency,
      current.anchorDay,
    )
  }

  const result = await database
    .prepare(`
      UPDATE recurring_rules
      SET
        is_active = ?,
        next_occurrence_on = ?,
        last_error_code = NULL,
        last_error_at = NULL,
        revision = revision + 1,
        cursor_version = cursor_version + 1,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ? AND revision = ? AND deleted_at IS NULL
    `)
    .bind(input.isActive ? 1 : 0, nextOccurrenceOn, id, input.revision)
    .run()

  if (Number(result.meta.changes) === 0) return { kind: 'version_conflict' }
  const updated = await findRule(database, id, false)
  if (!updated) throw new Error('Recurring status update did not produce a row')
  return { kind: 'updated', rule: toRuleView(updated) }
}

export async function deleteRecurringRule(
  database: D1Database,
  id: string,
  revision: number,
): Promise<DeleteRuleResult> {
  const current = await findRule(database, id, true)
  if (!current) return { kind: 'not_found' }
  if (current.deletedAt) {
    if (current.revision === revision || current.revision === revision + 1) {
      return { kind: 'deleted', id, revision: current.revision }
    }
    return { kind: 'version_conflict' }
  }
  if (current.revision !== revision) return { kind: 'version_conflict' }

  const result = await database
    .prepare(`
      UPDATE recurring_rules
      SET
        is_active = 0,
        deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        revision = revision + 1,
        cursor_version = cursor_version + 1,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ? AND revision = ? AND deleted_at IS NULL
    `)
    .bind(id, revision)
    .run()

  if (Number(result.meta.changes) === 0) return { kind: 'version_conflict' }
  return { kind: 'deleted', id, revision: revision + 1 }
}

export async function runDueRecurringRules(
  database: D1Database,
  asOf = hktCalendarDate(),
): Promise<RecurringGenerationResult> {
  const dueResult = await database
    .prepare(`
      ${recurringRuleSelect}
      WHERE
        r.deleted_at IS NULL
        AND r.is_active = 1
        AND r.next_occurrence_on <= ?
      ORDER BY r.next_occurrence_on ASC, r.id ASC
    `)
    .bind(asOf)
    .all<RuleRow>()

  const dueRules = dueResult.results
  const errors: RuleError[] = []
  const validRules: RuleRow[] = []
  for (const rule of dueRules) {
    const errorCode = referenceErrorFromRow(rule)
    if (errorCode) {
      errors.push({
        id: rule.id,
        revision: rule.revision,
        cursorVersion: rule.cursorVersion,
        expectedNextOn: rule.nextOccurrenceOn,
        code: errorCode,
      })
    } else {
      validRules.push(rule)
    }
  }

  let blocked = 0
  let failed = 0
  if (errors.length > 0) {
    try {
      blocked += await recordRuleErrors(database, errors)
    } catch {
      failed += errors.length
    }
  }

  const plan = planOccurrences(validRules, asOf)
  if (plan.selected.length > 0) {
    try {
      const result = await executeGenerationPlan(database, plan.selected, plan.updates)
      blocked += result.blocked
      failed += result.failed
      return {
        asOf,
        scanned: dueRules.length,
        created: result.created,
        alreadyExisting: result.alreadyExisting,
        blocked,
        truncated: plan.truncated,
        failed,
      }
    } catch {
      let created = 0
      let alreadyExisting = 0
      for (const update of plan.updates) {
        const selected = plan.selected.filter((item) => item.ruleId === update.ruleId)
        try {
          const result = await executeGenerationPlan(database, selected, [update])
          created += result.created
          alreadyExisting += result.alreadyExisting
          blocked += result.blocked
          failed += result.failed
        } catch {
          failed += 1
          try {
            blocked += await recordRuleErrors(database, [
              {
                id: update.ruleId,
                revision: update.revision,
                cursorVersion: update.cursorVersion,
                expectedNextOn: update.expectedNextOn,
                code: 'GENERATION_FAILED',
              },
            ])
          } catch {
            // The failure is already counted and other rules must still run.
          }
        }
      }

      return {
        asOf,
        scanned: dueRules.length,
        created,
        alreadyExisting,
        blocked,
        truncated: plan.truncated,
        failed,
      }
    }
  }

  return {
    asOf,
    scanned: dueRules.length,
    created: 0,
    alreadyExisting: 0,
    blocked,
    truncated: 0,
    failed,
  }
}

async function findRule(database: D1Database, id: string, includeDeleted: boolean) {
  return database
    .prepare(`
      ${recurringRuleSelect}
      WHERE r.id = ? ${includeDeleted ? '' : 'AND r.deleted_at IS NULL'}
      LIMIT 1
    `)
    .bind(id)
    .first<RuleRow>()
}

function toRuleView(row: RuleRow): RecurringRuleView {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    amountMinor: row.amountMinor,
    currency: row.currency,
    accountId: row.accountId,
    categoryId: row.categoryId,
    frequency: row.frequency,
    scheduleStartsOn: row.scheduleStartsOn,
    nextOccurrenceOn: row.nextOccurrenceOn,
    lastOccurrenceOn: row.lastOccurrenceOn,
    anchorDay: row.anchorDay,
    isActive: row.isActive === 1,
    payee: row.payee,
    note: row.note,
    generatedCount: row.generatedCount,
    lastErrorCode: row.lastErrorCode,
    revision: row.revision,
    accountName: row.accountName ?? '',
    categoryName: row.categoryName ?? '',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function matchesCreateInput(row: RuleRow, input: RecurringRuleCreateInput) {
  return (
    row.id === input.id &&
    row.name === input.name &&
    row.type === input.type &&
    row.amountMinor === input.amountMinor &&
    row.currency === input.currency &&
    row.accountId === input.accountId &&
    row.categoryId === input.categoryId &&
    row.frequency === input.frequency &&
    row.scheduleStartsOn === input.scheduleStartsOn &&
    row.isActive === (input.isActive ? 1 : 0) &&
    row.payee === input.payee &&
    row.note === input.note
  )
}

async function validateReferences(
  database: D1Database,
  accountId: number,
  categoryId: number,
  currency: 'HKD',
  type: TransactionType,
) {
  const row = await database
    .prepare(`
      SELECT
        a.id AS accountId,
        a.is_active AS accountIsActive,
        a.currency AS accountCurrency,
        category.id AS categoryId,
        category.is_active AS categoryIsActive,
        category.type AS categoryType
      FROM (SELECT 1) seed
      LEFT JOIN accounts a ON a.id = ?
      LEFT JOIN categories category ON category.id = ?
    `)
    .bind(accountId, categoryId)
    .first<{
      accountId: number | null
      accountIsActive: number | null
      accountCurrency: string | null
      categoryId: number | null
      categoryIsActive: number | null
      categoryType: string | null
    }>()

  if (!row?.accountId || row.accountIsActive !== 1 || row.accountCurrency !== currency) {
    return 'ACCOUNT_INVALID' as const
  }
  if (!row.categoryId || row.categoryIsActive !== 1) return 'CATEGORY_INVALID' as const
  if (row.categoryType !== type) return 'CATEGORY_TYPE_MISMATCH' as const
  return null
}

function referenceErrorFromRow(row: RuleRow): ReferenceErrorCode | null {
  if (!row.accountId || row.accountIsActive !== 1 || row.accountCurrency !== row.currency) {
    return 'ACCOUNT_INVALID'
  }
  if (!row.categoryId || row.categoryIsActive !== 1) return 'CATEGORY_INVALID'
  if (row.categoryType !== row.type) return 'CATEGORY_TYPE_MISMATCH'
  return null
}

function planOccurrences(rows: RuleRow[], asOf: string) {
  const states: PlannedRule[] = rows.map((row) => ({
    row,
    nextOn: row.nextOccurrenceOn,
    occurrences: [],
  }))

  let selectedCount = 0
  while (selectedCount < GENERATION_CAP) {
    const next = states
      .filter((state) => state.nextOn <= asOf)
      .sort((left, right) => {
        const dateOrder = left.nextOn.localeCompare(right.nextOn)
        return dateOrder === 0 ? left.row.id.localeCompare(right.row.id) : dateOrder
      })[0]
    if (!next) break

    next.occurrences.push(next.nextOn)
    next.nextOn = advanceOccurrence(next.nextOn, next.row.frequency, next.row.anchorDay)
    selectedCount += 1
  }

  const selected: PlannedOccurrence[] = []
  const updates: PlannedCursorUpdate[] = []
  for (const state of states) {
    if (state.occurrences.length === 0) continue
    updates.push({
      ruleId: state.row.id,
      revision: state.row.revision,
      cursorVersion: state.row.cursorVersion,
      expectedNextOn: state.row.nextOccurrenceOn,
      nextOn: state.nextOn,
    })
    for (const dueOn of state.occurrences) {
      selected.push({
        transactionId: crypto.randomUUID(),
        ruleId: state.row.id,
        revision: state.row.revision,
        cursorVersion: state.row.cursorVersion,
        expectedNextOn: state.row.nextOccurrenceOn,
        dueOn,
        occurrenceKey: `${state.row.id}:${dueOn}`,
      })
    }
  }

  return {
    selected,
    updates,
    truncated: states.filter((state) => state.nextOn <= asOf).length,
  }
}

async function executeGenerationPlan(
  database: D1Database,
  selected: PlannedOccurrence[],
  updates: PlannedCursorUpdate[],
): Promise<PlanExecutionResult> {
  const selectedJson = JSON.stringify(selected)
  const updatesJson = JSON.stringify(updates)
  const results = await database.batch<PresenceRow>([
    database.prepare(`
      WITH planned AS (
        SELECT
          json_extract(value, '$.transactionId') AS transaction_id,
          json_extract(value, '$.ruleId') AS rule_id,
          json_extract(value, '$.revision') AS revision,
          json_extract(value, '$.cursorVersion') AS cursor_version,
          json_extract(value, '$.expectedNextOn') AS expected_next_on,
          json_extract(value, '$.dueOn') AS due_on,
          json_extract(value, '$.occurrenceKey') AS occurrence_key
        FROM json_each(?)
      )
      INSERT INTO transactions(
        id,
        type,
        amount_minor,
        currency,
        account_id,
        category_id,
        occurred_on,
        payee,
        note,
        recurring_rule_id,
        recurring_rule_name,
        recurrence_due_on,
        recurring_occurrence_key
      )
      SELECT
        planned.transaction_id,
        r.type,
        r.amount_minor,
        r.currency,
        r.account_id,
        r.category_id,
        planned.due_on,
        r.payee,
        r.note,
        r.id,
        r.name,
        planned.due_on,
        planned.occurrence_key
      FROM planned
      INNER JOIN recurring_rules r ON r.id = planned.rule_id
      INNER JOIN accounts a ON a.id = r.account_id
      INNER JOIN categories category ON category.id = r.category_id
      WHERE
        r.deleted_at IS NULL
        AND r.is_active = 1
        AND r.revision = planned.revision
        AND r.cursor_version = planned.cursor_version
        AND r.next_occurrence_on = planned.expected_next_on
        AND a.is_active = 1
        AND a.currency = r.currency
        AND category.is_active = 1
        AND category.type = r.type
      ON CONFLICT(recurring_occurrence_key) DO NOTHING
    `).bind(selectedJson),
    database.prepare(`
      WITH planned AS (
        SELECT
          json_extract(value, '$.ruleId') AS rule_id,
          json_extract(value, '$.revision') AS revision,
          json_extract(value, '$.cursorVersion') AS cursor_version,
          json_extract(value, '$.expectedNextOn') AS expected_next_on,
          json_extract(value, '$.nextOn') AS next_on
        FROM json_each(?)
      )
      UPDATE recurring_rules AS r
      SET
        next_occurrence_on = (
          SELECT planned.next_on FROM planned WHERE planned.rule_id = r.id
        ),
        last_occurrence_on = (
          SELECT MAX(t.recurrence_due_on)
          FROM transactions t
          WHERE t.recurring_rule_id = r.id
        ),
        generated_count = (
          SELECT COUNT(*)
          FROM transactions t
          WHERE t.recurring_rule_id = r.id
        ),
        last_error_code = NULL,
        last_error_at = NULL,
        cursor_version = cursor_version + 1,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE
        r.deleted_at IS NULL
        AND r.is_active = 1
        AND EXISTS (
          SELECT 1
          FROM planned
          INNER JOIN accounts a ON a.id = r.account_id
          INNER JOIN categories category ON category.id = r.category_id
          WHERE
            planned.rule_id = r.id
            AND planned.revision = r.revision
            AND planned.cursor_version = r.cursor_version
            AND planned.expected_next_on = r.next_occurrence_on
            AND a.is_active = 1
            AND a.currency = r.currency
            AND category.is_active = 1
            AND category.type = r.type
        )
    `).bind(updatesJson),
    database.prepare(`
      WITH planned AS (
        SELECT
          json_extract(value, '$.ruleId') AS ruleId,
          json_extract(value, '$.occurrenceKey') AS occurrenceKey
        FROM json_each(?)
      )
      SELECT
        planned.ruleId,
        planned.occurrenceKey,
        t.id AS transactionId
      FROM planned
      LEFT JOIN transactions t ON t.recurring_occurrence_key = planned.occurrenceKey
    `).bind(selectedJson),
  ])

  const [insertResult, , presenceResult] = results
  const created = Number(insertResult?.meta.changes ?? 0)
  const presence = presenceResult?.results ?? []
  const existingAfter = presence.filter((row) => row.transactionId !== null).length
  const absentRuleIds = new Set(
    presence.filter((row) => row.transactionId === null).map((row) => row.ruleId),
  )

  let blocked = 0
  if (absentRuleIds.size > 0) {
    const updateById = new Map(updates.map((update) => [update.ruleId, update]))
    const errors: RuleError[] = []
    for (const id of absentRuleIds) {
      const update = updateById.get(id)
      if (!update) continue
      errors.push({
        id,
        revision: update.revision,
        cursorVersion: update.cursorVersion,
        expectedNextOn: update.expectedNextOn,
        code: 'GENERATION_RETRY_REQUIRED',
      })
    }
    if (errors.length > 0) blocked = await recordRuleErrors(database, errors)
  }

  return {
    created,
    alreadyExisting: Math.max(0, existingAfter - created),
    blocked,
    failed: Math.max(0, absentRuleIds.size - blocked),
  }
}

async function recordRuleErrors(database: D1Database, errors: RuleError[]) {
  const result = await database
    .prepare(`
      WITH errors AS (
        SELECT
          json_extract(value, '$.id') AS id,
          json_extract(value, '$.revision') AS revision,
          json_extract(value, '$.cursorVersion') AS cursor_version,
          json_extract(value, '$.expectedNextOn') AS expected_next_on,
          json_extract(value, '$.code') AS code
        FROM json_each(?)
      )
      UPDATE recurring_rules AS r
      SET
        last_error_code = (
          SELECT errors.code FROM errors WHERE errors.id = r.id
        ),
        last_error_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        cursor_version = cursor_version + 1,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE
        r.deleted_at IS NULL
        AND EXISTS (
          SELECT 1
          FROM errors
          WHERE
            errors.id = r.id
            AND errors.revision = r.revision
            AND errors.cursor_version = r.cursor_version
            AND errors.expected_next_on = r.next_occurrence_on
        )
    `)
    .bind(JSON.stringify(errors))
    .run()

  return Number(result.meta.changes)
}
