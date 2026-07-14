import {
  advanceOccurrence,
  firstOccurrenceOnOrAfter,
  recurrenceAnchorDay,
} from '../src/lib/recurrence'
import type { SupportedCurrency } from '../src/lib/currency'
import type {
  RecurrenceFrequency,
  RecurringTransferGenerationResult,
  RecurringTransferRuleCreateInput,
  RecurringTransferRuleSkipInput,
  RecurringTransferRuleUpdateInput,
} from '../src/lib/schema'
import { hktCalendarDate } from './recurring'

const GENERATION_CAP = 366

type RuleRow = {
  id: string
  name: string
  amountMinor: number
  currency: SupportedCurrency
  fromAccountId: number
  toAccountId: number
  frequency: RecurrenceFrequency
  scheduleStartsOn: string
  scheduleEndsOn: string | null
  nextOccurrenceOn: string
  lastOccurrenceOn: string | null
  anchorDay: number
  isActive: number
  note: string
  generatedCount: number
  lastErrorCode: string | null
  revision: number
  cursorVersion: number
  deletedAt: string | null
  createdAt: string
  updatedAt: string
  fromAccountName: string | null
  fromAccountIsActive: number | null
  fromAccountCurrency: string | null
  fromAccountOpeningBalanceOn: string | null
  toAccountName: string | null
  toAccountIsActive: number | null
  toAccountCurrency: string | null
  toAccountOpeningBalanceOn: string | null
}

export type RecurringTransferRuleView = {
  id: string
  name: string
  amountMinor: number
  currency: SupportedCurrency
  fromAccountId: number
  toAccountId: number
  frequency: RecurrenceFrequency
  scheduleStartsOn: string
  scheduleEndsOn: string | null
  nextOccurrenceOn: string
  lastOccurrenceOn: string | null
  anchorDay: number
  isActive: boolean
  note: string
  generatedCount: number
  lastErrorCode: string | null
  revision: number
  fromAccountName: string
  toAccountName: string
  createdAt: string
  updatedAt: string
}

export type RecurringTransferReferenceErrorCode =
  | 'ACCOUNT_INVALID'
  | 'ACCOUNT_OPENING_DATE_AFTER_DUE'

export type CreateRecurringTransferRuleResult =
  | { kind: 'created' | 'existing'; rule: RecurringTransferRuleView }
  | { kind: 'id_conflict' }
  | { kind: 'reference_invalid'; code: RecurringTransferReferenceErrorCode }

export type UpdateRecurringTransferRuleResult =
  | { kind: 'updated'; rule: RecurringTransferRuleView }
  | { kind: 'not_found' }
  | { kind: 'version_conflict' }
  | { kind: 'reference_invalid'; code: RecurringTransferReferenceErrorCode }

export type DeleteRecurringTransferRuleResult =
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
  transferId: string
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
  transferId: string | null
}

type PlanExecutionResult = {
  created: number
  alreadyExisting: number
  blocked: number
  failed: number
}

const recurringTransferRuleSelect = `
  SELECT
    r.id,
    r.name,
    r.amount_minor AS amountMinor,
    r.currency,
    r.from_account_id AS fromAccountId,
    r.to_account_id AS toAccountId,
    r.frequency,
    r.schedule_starts_on AS scheduleStartsOn,
    r.schedule_ends_on AS scheduleEndsOn,
    r.next_occurrence_on AS nextOccurrenceOn,
    r.last_occurrence_on AS lastOccurrenceOn,
    r.anchor_day AS anchorDay,
    r.is_active AS isActive,
    r.note,
    r.generated_count AS generatedCount,
    r.last_error_code AS lastErrorCode,
    r.revision,
    r.cursor_version AS cursorVersion,
    r.deleted_at AS deletedAt,
    r.created_at AS createdAt,
    r.updated_at AS updatedAt,
    source.name AS fromAccountName,
    source.is_active AS fromAccountIsActive,
    source.currency AS fromAccountCurrency,
    source.opening_balance_on AS fromAccountOpeningBalanceOn,
    destination.name AS toAccountName,
    destination.is_active AS toAccountIsActive,
    destination.currency AS toAccountCurrency,
    destination.opening_balance_on AS toAccountOpeningBalanceOn
  FROM recurring_transfer_rules r
  LEFT JOIN accounts source ON source.id = r.from_account_id
  LEFT JOIN accounts destination ON destination.id = r.to_account_id
`

function occursAfterScheduleEnd(occurrenceOn: string, scheduleEndsOn: string | null) {
  return scheduleEndsOn !== null && occurrenceOn > scheduleEndsOn
}

function isCompletedRule(rule: Pick<RuleRow, 'nextOccurrenceOn' | 'scheduleEndsOn'>) {
  return occursAfterScheduleEnd(rule.nextOccurrenceOn, rule.scheduleEndsOn)
}

export async function listRecurringTransferRules(database: D1Database) {
  const result = await database.prepare(`
    ${recurringTransferRuleSelect}
    WHERE r.deleted_at IS NULL
    ORDER BY r.is_active DESC, r.schedule_starts_on ASC, r.created_at ASC, r.id ASC
  `).all<RuleRow>()

  return result.results.map(toRuleView)
}

export async function getRecurringTransferRule(database: D1Database, id: string) {
  const row = await findRule(database, id, false)
  return row ? toRuleView(row) : null
}

export async function createRecurringTransferRule(
  database: D1Database,
  input: RecurringTransferRuleCreateInput,
  today = hktCalendarDate(),
): Promise<CreateRecurringTransferRuleResult> {
  const existing = await findRule(database, input.id, true)
  if (existing) {
    if (existing.deletedAt || !matchesCreateInput(existing, input)) return { kind: 'id_conflict' }
    return { kind: 'existing', rule: toRuleView(existing) }
  }

  const referenceError = await validateReferences(
    database,
    input.fromAccountId,
    input.toAccountId,
    input.currency,
  )
  if (referenceError) return { kind: 'reference_invalid', code: referenceError }

  const anchorDay = recurrenceAnchorDay(input.scheduleStartsOn)
  const nextOccurrenceOn = firstOccurrenceOnOrAfter(
    input.scheduleStartsOn,
    today,
    input.frequency,
    anchorDay,
  )
  const scheduleEndsOn = input.scheduleEndsOn ?? null
  const isActive = input.isActive && !occursAfterScheduleEnd(nextOccurrenceOn, scheduleEndsOn)
  const inserted = await database.prepare(`
    INSERT INTO recurring_transfer_rules(
      id,
      name,
      amount_minor,
      currency,
      from_account_id,
      to_account_id,
      frequency,
      schedule_starts_on,
      schedule_ends_on,
      next_occurrence_on,
      anchor_day,
      is_active,
      note
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE ? <> ?
      AND EXISTS (
        SELECT 1 FROM accounts WHERE id = ? AND is_active = 1 AND currency = ?
      )
      AND EXISTS (
        SELECT 1 FROM accounts WHERE id = ? AND is_active = 1 AND currency = ?
      )
    ON CONFLICT(id) DO NOTHING
  `).bind(
    input.id,
    input.name,
    input.amountMinor,
    input.currency,
    input.fromAccountId,
    input.toAccountId,
    input.frequency,
    input.scheduleStartsOn,
    scheduleEndsOn,
    nextOccurrenceOn,
    anchorDay,
    isActive ? 1 : 0,
    input.note,
    input.fromAccountId,
    input.toAccountId,
    input.fromAccountId,
    input.currency,
    input.toAccountId,
    input.currency,
  ).run()

  const rule = await findRule(database, input.id, true)
  if (!rule) {
    const currentReferenceError = await validateReferences(
      database,
      input.fromAccountId,
      input.toAccountId,
      input.currency,
    )
    if (currentReferenceError) return { kind: 'reference_invalid', code: currentReferenceError }
    throw new Error('Recurring transfer rule insert did not produce a row')
  }
  if (rule.deletedAt || !matchesCreateInput(rule, input)) return { kind: 'id_conflict' }

  return {
    kind: Number(inserted.meta.changes) > 0 ? 'created' : 'existing',
    rule: toRuleView(rule),
  }
}

export async function updateRecurringTransferRule(
  database: D1Database,
  id: string,
  input: RecurringTransferRuleUpdateInput,
  today = hktCalendarDate(),
): Promise<UpdateRecurringTransferRuleResult> {
  const current = await findRule(database, id, true)
  if (!current || current.deletedAt) return { kind: 'not_found' }
  if (current.revision !== input.revision) return { kind: 'version_conflict' }

  const referenceError = await validateReferences(
    database,
    input.fromAccountId,
    input.toAccountId,
    input.currency,
  )
  if (referenceError) return { kind: 'reference_invalid', code: referenceError }

  if (
    input.scheduleEndsOn === undefined
    && current.scheduleEndsOn !== null
    && current.scheduleEndsOn < input.scheduleStartsOn
  ) {
    return { kind: 'version_conflict' }
  }

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
  const scheduleEndsOn = input.scheduleEndsOn === undefined
    ? current.scheduleEndsOn
    : input.scheduleEndsOn
  const isActive = input.isActive && !occursAfterScheduleEnd(nextOccurrenceOn, scheduleEndsOn)
  const result = await database.prepare(`
    UPDATE recurring_transfer_rules
    SET
      name = ?,
      amount_minor = ?,
      currency = ?,
      from_account_id = ?,
      to_account_id = ?,
      frequency = ?,
      schedule_starts_on = ?,
      schedule_ends_on = ?,
      next_occurrence_on = ?,
      anchor_day = ?,
      is_active = ?,
      note = ?,
      last_error_code = NULL,
      last_error_at = NULL,
      revision = revision + 1,
      cursor_version = cursor_version + 1,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?
      AND revision = ?
      AND cursor_version = ?
      AND next_occurrence_on = ?
      AND deleted_at IS NULL
      AND ? <> ?
      AND EXISTS (
        SELECT 1 FROM accounts WHERE id = ? AND is_active = 1 AND currency = ?
      )
      AND EXISTS (
        SELECT 1 FROM accounts WHERE id = ? AND is_active = 1 AND currency = ?
      )
  `).bind(
    input.name,
    input.amountMinor,
    input.currency,
    input.fromAccountId,
    input.toAccountId,
    input.frequency,
    input.scheduleStartsOn,
    scheduleEndsOn,
    nextOccurrenceOn,
    anchorDay,
    isActive ? 1 : 0,
    input.note,
    id,
    input.revision,
    current.cursorVersion,
    current.nextOccurrenceOn,
    input.fromAccountId,
    input.toAccountId,
    input.fromAccountId,
    input.currency,
    input.toAccountId,
    input.currency,
  ).run()

  if (Number(result.meta.changes) === 0) {
    const latest = await findRule(database, id, true)
    if (!latest || latest.deletedAt) return { kind: 'not_found' }
    if (latest.revision !== input.revision) return { kind: 'version_conflict' }
    const currentReferenceError = await validateReferences(
      database,
      input.fromAccountId,
      input.toAccountId,
      input.currency,
    )
    return currentReferenceError
      ? { kind: 'reference_invalid', code: currentReferenceError }
      : { kind: 'version_conflict' }
  }

  const updated = await findRule(database, id, false)
  if (!updated) throw new Error('Recurring transfer rule update did not produce a row')
  return { kind: 'updated', rule: toRuleView(updated) }
}

export async function setRecurringTransferRuleStatus(
  database: D1Database,
  id: string,
  input: { isActive: boolean; revision: number },
  today = hktCalendarDate(),
): Promise<UpdateRecurringTransferRuleResult> {
  const current = await findRule(database, id, true)
  if (!current || current.deletedAt) return { kind: 'not_found' }
  if (current.revision !== input.revision) return { kind: 'version_conflict' }

  if (input.isActive && !isCompletedRule(current)) {
    const referenceError = await validateReferences(
      database,
      current.fromAccountId,
      current.toAccountId,
      current.currency,
    )
    if (referenceError) return { kind: 'reference_invalid', code: referenceError }
  }

  let nextOccurrenceOn = current.nextOccurrenceOn
  if (input.isActive && current.isActive !== 1) {
    nextOccurrenceOn = firstOccurrenceOnOrAfter(
      current.nextOccurrenceOn,
      today,
      current.frequency,
      current.anchorDay,
    )
  }
  const isActive = input.isActive
    && !occursAfterScheduleEnd(nextOccurrenceOn, current.scheduleEndsOn)
  const result = await database.prepare(`
    UPDATE recurring_transfer_rules
    SET
      is_active = ?,
      next_occurrence_on = ?,
      last_error_code = NULL,
      last_error_at = NULL,
      revision = revision + 1,
      cursor_version = cursor_version + 1,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?
      AND revision = ?
      AND cursor_version = ?
      AND next_occurrence_on = ?
      AND deleted_at IS NULL
      AND (? = 0 OR (
        ? <> ?
        AND EXISTS (
          SELECT 1 FROM accounts WHERE id = ? AND is_active = 1 AND currency = ?
        )
        AND EXISTS (
          SELECT 1 FROM accounts WHERE id = ? AND is_active = 1 AND currency = ?
        )
      ))
  `).bind(
    isActive ? 1 : 0,
    nextOccurrenceOn,
    id,
    input.revision,
    current.cursorVersion,
    current.nextOccurrenceOn,
    isActive ? 1 : 0,
    current.fromAccountId,
    current.toAccountId,
    current.fromAccountId,
    current.currency,
    current.toAccountId,
    current.currency,
  ).run()

  if (Number(result.meta.changes) === 0) {
    const latest = await findRule(database, id, true)
    if (!latest || latest.deletedAt) return { kind: 'not_found' }
    if (latest.revision !== input.revision) return { kind: 'version_conflict' }
    if (isActive) {
      const currentReferenceError = await validateReferences(
        database,
        current.fromAccountId,
        current.toAccountId,
        current.currency,
      )
      if (currentReferenceError) {
        return { kind: 'reference_invalid', code: currentReferenceError }
      }
    }
    return { kind: 'version_conflict' }
  }

  const updated = await findRule(database, id, false)
  if (!updated) throw new Error('Recurring transfer status update did not produce a row')
  return { kind: 'updated', rule: toRuleView(updated) }
}

export async function skipRecurringTransferRuleOccurrence(
  database: D1Database,
  id: string,
  input: RecurringTransferRuleSkipInput,
): Promise<UpdateRecurringTransferRuleResult> {
  const current = await findRule(database, id, true)
  if (!current || current.deletedAt) return { kind: 'not_found' }
  if (
    current.revision !== input.revision
    || current.nextOccurrenceOn !== input.nextOccurrenceOn
  ) {
    return { kind: 'version_conflict' }
  }
  if (isCompletedRule(current)) return { kind: 'updated', rule: toRuleView(current) }

  const nextOccurrenceOn = advanceOccurrence(
    current.nextOccurrenceOn,
    current.frequency,
    current.anchorDay,
  )
  const isActive = current.isActive === 1
    && !occursAfterScheduleEnd(nextOccurrenceOn, current.scheduleEndsOn)
  const result = await database.prepare(`
    UPDATE recurring_transfer_rules
    SET
      next_occurrence_on = ?,
      is_active = ?,
      last_error_code = NULL,
      last_error_at = NULL,
      revision = revision + 1,
      cursor_version = cursor_version + 1,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE
      id = ?
      AND revision = ?
      AND cursor_version = ?
      AND next_occurrence_on = ?
      AND deleted_at IS NULL
  `).bind(
    nextOccurrenceOn,
    isActive ? 1 : 0,
    id,
    input.revision,
    current.cursorVersion,
    input.nextOccurrenceOn,
  ).run()

  if (Number(result.meta.changes) === 0) {
    const latest = await findRule(database, id, true)
    return !latest || latest.deletedAt
      ? { kind: 'not_found' }
      : { kind: 'version_conflict' }
  }

  const updated = await findRule(database, id, false)
  if (!updated) throw new Error('Recurring transfer skip did not produce a row')
  return { kind: 'updated', rule: toRuleView(updated) }
}

export async function deleteRecurringTransferRule(
  database: D1Database,
  id: string,
  revision: number,
): Promise<DeleteRecurringTransferRuleResult> {
  const current = await findRule(database, id, true)
  if (!current) return { kind: 'not_found' }
  if (current.deletedAt) {
    if (current.revision === revision || current.revision === revision + 1) {
      return { kind: 'deleted', id, revision: current.revision }
    }
    return { kind: 'version_conflict' }
  }
  if (current.revision !== revision) return { kind: 'version_conflict' }

  const result = await database.prepare(`
    UPDATE recurring_transfer_rules
    SET
      is_active = 0,
      deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      revision = revision + 1,
      cursor_version = cursor_version + 1,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?
      AND revision = ?
      AND cursor_version = ?
      AND next_occurrence_on = ?
      AND deleted_at IS NULL
  `).bind(id, revision, current.cursorVersion, current.nextOccurrenceOn).run()

  if (Number(result.meta.changes) === 0) return { kind: 'version_conflict' }
  return { kind: 'deleted', id, revision: revision + 1 }
}

export async function runDueRecurringTransferRules(
  database: D1Database,
  asOf = hktCalendarDate(),
): Promise<RecurringTransferGenerationResult> {
  const dueResult = await database.prepare(`
    ${recurringTransferRuleSelect}
    WHERE
      r.deleted_at IS NULL
      AND r.is_active = 1
      AND r.next_occurrence_on <= ?
      AND (r.schedule_ends_on IS NULL OR r.next_occurrence_on <= r.schedule_ends_on)
    ORDER BY r.next_occurrence_on ASC, r.id ASC
  `).bind(asOf).all<RuleRow>()

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
            blocked += await recordRuleErrors(database, [{
              id: update.ruleId,
              revision: update.revision,
              cursorVersion: update.cursorVersion,
              expectedNextOn: update.expectedNextOn,
              code: 'GENERATION_FAILED',
            }])
          } catch {
            // The failure is counted and must not prevent unrelated rules from running.
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
  return database.prepare(`
    ${recurringTransferRuleSelect}
    WHERE r.id = ? ${includeDeleted ? '' : 'AND r.deleted_at IS NULL'}
    LIMIT 1
  `).bind(id).first<RuleRow>()
}

function toRuleView(row: RuleRow): RecurringTransferRuleView {
  return {
    id: row.id,
    name: row.name,
    amountMinor: row.amountMinor,
    currency: row.currency,
    fromAccountId: row.fromAccountId,
    toAccountId: row.toAccountId,
    frequency: row.frequency,
    scheduleStartsOn: row.scheduleStartsOn,
    scheduleEndsOn: row.scheduleEndsOn,
    nextOccurrenceOn: row.nextOccurrenceOn,
    lastOccurrenceOn: row.lastOccurrenceOn,
    anchorDay: row.anchorDay,
    isActive: row.isActive === 1 && !isCompletedRule(row),
    note: row.note,
    generatedCount: row.generatedCount,
    lastErrorCode: row.lastErrorCode,
    revision: row.revision,
    fromAccountName: row.fromAccountName ?? '',
    toAccountName: row.toAccountName ?? '',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function matchesCreateInput(row: RuleRow, input: RecurringTransferRuleCreateInput) {
  const scheduleEndsOn = input.scheduleEndsOn ?? null
  const isActive = input.isActive && !occursAfterScheduleEnd(row.nextOccurrenceOn, scheduleEndsOn)
  return (
    row.id === input.id
    && row.name === input.name
    && row.amountMinor === input.amountMinor
    && row.currency === input.currency
    && row.fromAccountId === input.fromAccountId
    && row.toAccountId === input.toAccountId
    && row.frequency === input.frequency
    && row.scheduleStartsOn === input.scheduleStartsOn
    && row.scheduleEndsOn === scheduleEndsOn
    && row.isActive === (isActive ? 1 : 0)
    && row.note === input.note
  )
}

async function validateReferences(
  database: D1Database,
  fromAccountId: number,
  toAccountId: number,
  currency: SupportedCurrency,
): Promise<RecurringTransferReferenceErrorCode | null> {
  if (fromAccountId === toAccountId) return 'ACCOUNT_INVALID'
  const result = await database.prepare(`
    SELECT id, is_active AS isActive, currency
    FROM accounts
    WHERE id IN (?, ?)
  `).bind(fromAccountId, toAccountId).all<{
    id: number
    isActive: number
    currency: string
  }>()
  const accounts = new Map(result.results.map((account) => [account.id, account]))
  return [fromAccountId, toAccountId].every((id) => {
    const account = accounts.get(id)
    return account?.isActive === 1 && account.currency === currency
  }) ? null : 'ACCOUNT_INVALID'
}

function referenceErrorFromRow(row: RuleRow): RecurringTransferReferenceErrorCode | null {
  if (
    row.fromAccountId === row.toAccountId
    || !row.fromAccountName
    || row.fromAccountIsActive !== 1
    || row.fromAccountCurrency !== row.currency
    || !row.toAccountName
    || row.toAccountIsActive !== 1
    || row.toAccountCurrency !== row.currency
  ) {
    return 'ACCOUNT_INVALID'
  }
  if (
    (row.fromAccountOpeningBalanceOn !== null
      && row.nextOccurrenceOn < row.fromAccountOpeningBalanceOn)
    || (row.toAccountOpeningBalanceOn !== null
      && row.nextOccurrenceOn < row.toAccountOpeningBalanceOn)
  ) {
    return 'ACCOUNT_OPENING_DATE_AFTER_DUE'
  }
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
    const next = states.filter((state) => (
      state.nextOn <= asOf
      && !occursAfterScheduleEnd(state.nextOn, state.row.scheduleEndsOn)
    )).sort((left, right) => {
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
        transferId: crypto.randomUUID(),
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
    truncated: states.filter((state) => (
      state.nextOn <= asOf
      && !occursAfterScheduleEnd(state.nextOn, state.row.scheduleEndsOn)
    )).length,
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
          json_extract(value, '$.ruleId') AS ruleId,
          json_extract(value, '$.occurrenceKey') AS occurrenceKey
        FROM json_each(?)
      )
      SELECT
        planned.ruleId,
        planned.occurrenceKey,
        transfer.id AS transferId
      FROM planned
      LEFT JOIN account_transfers transfer
        ON transfer.recurring_occurrence_key = planned.occurrenceKey
    `).bind(selectedJson),
    database.prepare(`
      WITH planned AS (
        SELECT
          json_extract(value, '$.transferId') AS transfer_id,
          json_extract(value, '$.ruleId') AS rule_id,
          json_extract(value, '$.revision') AS revision,
          json_extract(value, '$.cursorVersion') AS cursor_version,
          json_extract(value, '$.expectedNextOn') AS expected_next_on,
          json_extract(value, '$.dueOn') AS due_on,
          json_extract(value, '$.occurrenceKey') AS occurrence_key
        FROM json_each(?)
      )
      INSERT INTO account_transfers(
        id,
        amount_minor,
        currency,
        from_account_id,
        to_account_id,
        occurred_on,
        from_cleared,
        to_cleared,
        note,
        recurring_transfer_rule_id,
        recurring_transfer_rule_name,
        recurrence_due_on,
        recurring_occurrence_key
      )
      SELECT
        planned.transfer_id,
        r.amount_minor,
        r.currency,
        r.from_account_id,
        r.to_account_id,
        planned.due_on,
        0,
        0,
        r.note,
        r.id,
        r.name,
        planned.due_on,
        planned.occurrence_key
      FROM planned
      INNER JOIN recurring_transfer_rules r ON r.id = planned.rule_id
      INNER JOIN accounts source ON source.id = r.from_account_id
      INNER JOIN accounts destination ON destination.id = r.to_account_id
      WHERE
        r.deleted_at IS NULL
        AND r.is_active = 1
        AND r.revision = planned.revision
        AND r.cursor_version = planned.cursor_version
        AND r.next_occurrence_on = planned.expected_next_on
        AND (r.schedule_ends_on IS NULL OR planned.due_on <= r.schedule_ends_on)
        AND r.from_account_id <> r.to_account_id
        AND source.is_active = 1
        AND source.currency = r.currency
        AND destination.is_active = 1
        AND destination.currency = r.currency
        AND (source.opening_balance_on IS NULL OR planned.due_on >= source.opening_balance_on)
        AND (destination.opening_balance_on IS NULL OR planned.due_on >= destination.opening_balance_on)
      ON CONFLICT(recurring_occurrence_key) DO NOTHING
    `).bind(selectedJson),
    database.prepare(`
      WITH
      planned_updates AS (
        SELECT
          json_extract(value, '$.ruleId') AS rule_id,
          json_extract(value, '$.revision') AS revision,
          json_extract(value, '$.cursorVersion') AS cursor_version,
          json_extract(value, '$.expectedNextOn') AS expected_next_on,
          json_extract(value, '$.nextOn') AS next_on
        FROM json_each(?)
      ),
      planned_occurrences AS (
        SELECT
          json_extract(value, '$.ruleId') AS rule_id,
          json_extract(value, '$.occurrenceKey') AS occurrence_key
        FROM json_each(?)
      )
      UPDATE recurring_transfer_rules AS r
      SET
        next_occurrence_on = (
          SELECT planned_updates.next_on
          FROM planned_updates
          WHERE planned_updates.rule_id = r.id
        ),
        is_active = CASE
          WHEN r.schedule_ends_on IS NOT NULL AND (
            SELECT planned_updates.next_on
            FROM planned_updates
            WHERE planned_updates.rule_id = r.id
          ) > r.schedule_ends_on THEN 0
          ELSE r.is_active
        END,
        last_occurrence_on = (
          SELECT MAX(transfer.recurrence_due_on)
          FROM account_transfers transfer
          WHERE transfer.recurring_transfer_rule_id = r.id
        ),
        generated_count = (
          SELECT COUNT(*)
          FROM account_transfers transfer
          WHERE transfer.recurring_transfer_rule_id = r.id
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
          FROM planned_updates
          INNER JOIN accounts source ON source.id = r.from_account_id
          INNER JOIN accounts destination ON destination.id = r.to_account_id
          WHERE
            planned_updates.rule_id = r.id
            AND planned_updates.revision = r.revision
            AND planned_updates.cursor_version = r.cursor_version
            AND planned_updates.expected_next_on = r.next_occurrence_on
            AND r.from_account_id <> r.to_account_id
            AND source.is_active = 1
            AND source.currency = r.currency
            AND destination.is_active = 1
            AND destination.currency = r.currency
            AND (source.opening_balance_on IS NULL
              OR planned_updates.expected_next_on >= source.opening_balance_on)
            AND (destination.opening_balance_on IS NULL
              OR planned_updates.expected_next_on >= destination.opening_balance_on)
        )
        AND NOT EXISTS (
          SELECT 1
          FROM planned_occurrences
          WHERE planned_occurrences.rule_id = r.id
            AND NOT EXISTS (
              SELECT 1
              FROM account_transfers transfer
              WHERE transfer.recurring_occurrence_key = planned_occurrences.occurrence_key
            )
        )
    `).bind(updatesJson, selectedJson),
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
        transfer.id AS transferId
      FROM planned
      LEFT JOIN account_transfers transfer
        ON transfer.recurring_occurrence_key = planned.occurrenceKey
    `).bind(selectedJson),
  ])

  const [beforePresenceResult, , , presenceResult] = results
  const existingBefore = beforePresenceResult?.results
    .filter((row) => row.transferId !== null).length ?? 0
  const presence = presenceResult?.results ?? []
  const existingAfter = presence.filter((row) => row.transferId !== null).length
  const created = Math.max(0, existingAfter - existingBefore)
  const absentRuleIds = new Set(
    presence.filter((row) => row.transferId === null).map((row) => row.ruleId),
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
  const payload = JSON.stringify(errors)
  const [, verification] = await database.batch<{ count: number }>([
    database.prepare(`
      WITH errors AS (
        SELECT
          json_extract(value, '$.id') AS id,
          json_extract(value, '$.revision') AS revision,
          json_extract(value, '$.cursorVersion') AS cursor_version,
          json_extract(value, '$.expectedNextOn') AS expected_next_on,
          json_extract(value, '$.code') AS code
        FROM json_each(?)
      )
      UPDATE recurring_transfer_rules AS r
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
    `).bind(payload),
    database.prepare(`
      WITH errors AS (
        SELECT
          json_extract(value, '$.id') AS id,
          json_extract(value, '$.cursorVersion') AS cursor_version,
          json_extract(value, '$.code') AS code
        FROM json_each(?)
      )
      SELECT COUNT(*) AS count
      FROM recurring_transfer_rules r
      INNER JOIN errors ON errors.id = r.id
      WHERE
        r.cursor_version = errors.cursor_version + 1
        AND r.last_error_code = errors.code
    `).bind(payload),
  ])

  return verification?.results[0]?.count ?? 0
}
