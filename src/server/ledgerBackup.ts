import 'server-only'

import {
  LEDGER_BACKUP_FORMAT,
  LEDGER_BACKUP_VERSION,
  LEDGER_RESTORE_CHUNK_BYTES,
  LEDGER_SCHEMA_VERSION,
  MAX_LEDGER_RESTORE_BATCH_STATEMENTS,
  checksumLedgerBackupPayload,
  compatibleLedgerBackupPayloadSchema,
  countLedgerData,
  digestLedgerData,
  ledgerBackupDataSchema,
  ledgerBackupPayloadSchema,
  upgradeLedgerBackupData,
  validateLedgerDataRelations,
  type CompatibleLedgerBackup,
  type LedgerBackup,
  type LedgerBackupData,
  type CompatibleLedgerBackupPayload,
  type LedgerRestoreCommitResult,
  type LedgerRestorePreview,
  type LedgerTableCounts,
  type LedgerValidationIssue,
} from '../lib/ledgerBackup'
import type { SupportedCurrency } from '../lib/currency'

type RawAccount = Omit<LedgerBackupData['accounts'][number], 'isActive'> & { isActive: number }
type RawCategory = Omit<LedgerBackupData['categories'][number], 'isActive'> & { isActive: number }
type RawRecurringRule = Omit<LedgerBackupData['recurringRules'][number], 'isActive'> & { isActive: number }
type RawRecurringTransferRule = Omit<
  LedgerBackupData['recurringTransferRules'][number],
  'isActive'
> & { isActive: number }
type RawTransaction = Omit<LedgerBackupData['transactions'][number], 'cleared'> & { cleared: number }
type RawAccountTransfer = Omit<
  LedgerBackupData['accountTransfers'][number],
  'fromCleared' | 'toCleared'
> & { fromCleared: number; toCleared: number }
type RawEcbReferenceRate = LedgerBackupData['ecbReferenceRates'][number]
type LedgerRevisionRow = { revision: number }
type LedgerSettingsRow = { currency: SupportedCurrency }

type LedgerSnapshot = {
  data: LedgerBackupData
  revision: number
}

export type VerifiedLedgerBackup = {
  exportedAt: string
  currency: SupportedCurrency
  checksum: string
  backupDigest: string
  backupCounts: LedgerTableCounts
  chunks: LedgerRestoreChunks
  restoreStatements: number
}

export type LedgerBackupVerification =
  | { ok: true; value: VerifiedLedgerBackup }
  | { ok: false; code: 'BACKUP_CHECKSUM_MISMATCH'; issues: LedgerValidationIssue[] }
  | { ok: false; code: 'BACKUP_DATA_INVALID'; issues: LedgerValidationIssue[] }
  | { ok: false; code: 'BACKUP_RESTORE_TOO_LARGE'; issues: LedgerValidationIssue[] }

export type LedgerRestoreResult =
  | { ok: true; value: LedgerRestoreCommitResult }
  | { ok: false; code: 'BACKUP_PREVIEW_STALE' }

type LedgerRestoreChunks = {
  accounts: string[]
  categories: string[]
  recurringRules: string[]
  recurringTransferRules: string[]
  transactions: string[]
  accountTransfers: string[]
  emergencyFundGoals: string[]
  transactionImportKeys: string[]
  ecbReferenceRates: string[]
}

const accountQuery = `
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
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM accounts
  ORDER BY id ASC
`

const categoryQuery = `
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
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM categories
  ORDER BY id ASC
`

const recurringRuleQuery = `
  SELECT
    id,
    name,
    type,
    amount_minor AS amountMinor,
    currency,
    account_id AS accountId,
    category_id AS categoryId,
    frequency,
    schedule_starts_on AS scheduleStartsOn,
    schedule_ends_on AS scheduleEndsOn,
    next_occurrence_on AS nextOccurrenceOn,
    last_occurrence_on AS lastOccurrenceOn,
    anchor_day AS anchorDay,
    is_active AS isActive,
    payee,
    note,
    generated_count AS generatedCount,
    last_error_code AS lastErrorCode,
    last_error_at AS lastErrorAt,
    revision,
    cursor_version AS cursorVersion,
    deleted_at AS deletedAt,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM recurring_rules
  ORDER BY id ASC
`

const recurringTransferRuleQuery = `
  SELECT
    id,
    name,
    amount_minor AS amountMinor,
    currency,
    from_account_id AS fromAccountId,
    to_account_id AS toAccountId,
    frequency,
    schedule_starts_on AS scheduleStartsOn,
    schedule_ends_on AS scheduleEndsOn,
    next_occurrence_on AS nextOccurrenceOn,
    last_occurrence_on AS lastOccurrenceOn,
    anchor_day AS anchorDay,
    is_active AS isActive,
    note,
    generated_count AS generatedCount,
    last_error_code AS lastErrorCode,
    last_error_at AS lastErrorAt,
    revision,
    cursor_version AS cursorVersion,
    deleted_at AS deletedAt,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM recurring_transfer_rules
  ORDER BY id ASC
`

const transactionQuery = `
  SELECT
    id,
    type,
    amount_minor AS amountMinor,
    currency,
    account_id AS accountId,
    category_id AS categoryId,
    occurred_on AS occurredOn,
    cleared,
    import_review_status AS importReviewStatus,
    payee,
    note,
    recurring_rule_id AS recurringRuleId,
    recurring_rule_name AS recurringRuleName,
    recurrence_due_on AS recurrenceDueOn,
    recurring_occurrence_key AS recurringOccurrenceKey,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM transactions
  ORDER BY id ASC
`

const accountTransferQuery = `
  SELECT
    id,
    amount_minor AS amountMinor,
    currency,
    from_account_id AS fromAccountId,
    to_account_id AS toAccountId,
    occurred_on AS occurredOn,
    from_cleared AS fromCleared,
    to_cleared AS toCleared,
    note,
    recurring_transfer_rule_id AS recurringTransferRuleId,
    recurring_transfer_rule_name AS recurringTransferRuleName,
    recurrence_due_on AS recurrenceDueOn,
    recurring_occurrence_key AS recurringOccurrenceKey,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM account_transfers
  ORDER BY id ASC
`

const emergencyFundGoalQuery = `
  SELECT
    id,
    account_id AS accountId,
    target_minor AS targetMinor,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM emergency_fund_goals
  ORDER BY id ASC
`

const importKeyQuery = `
  SELECT
    import_key AS importKey,
    transaction_id AS transactionId,
    imported_at AS importedAt
  FROM transaction_import_keys
  ORDER BY import_key ASC
`

const ecbReferenceRateQuery = `
  SELECT
    quote_currency AS quoteCurrency,
    rate,
    observed_on AS observedOn,
    fetched_at AS fetchedAt
  FROM ecb_reference_rates
  WHERE source = 'ecb' AND base_currency = 'EUR'
  ORDER BY observed_on ASC, quote_currency ASC
`

const revisionQuery = 'SELECT revision FROM ledger_state WHERE id = 1'
const ledgerSettingsQuery = 'SELECT currency FROM ledger_settings WHERE id = 1'
const nextLedgerSettingsUpdatedAt = `
  CASE
    WHEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') > updated_at
      THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    ELSE strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+0.001 seconds')
  END
`

const accountInsert = `
  INSERT INTO accounts(
    id, name, type, currency, is_active, sort_order, localization_key,
    opening_balance_minor, opening_balance_on, created_at, updated_at
  )
  SELECT
    json_extract(value, '$.id'),
    json_extract(value, '$.name'),
    json_extract(value, '$.type'),
    json_extract(value, '$.currency'),
    json_extract(value, '$.isActive'),
    json_extract(value, '$.sortOrder'),
    json_extract(value, '$.localizationKey'),
    json_extract(value, '$.openingBalanceMinor'),
    json_extract(value, '$.openingBalanceOn'),
    json_extract(value, '$.createdAt'),
    json_extract(value, '$.updatedAt')
  FROM json_each(?)
`

const categoryInsert = `
  INSERT INTO categories(
    id, name, type, icon, color, is_active, sort_order, localization_key,
    monthly_plan_minor, created_at, updated_at
  )
  SELECT
    json_extract(value, '$.id'),
    json_extract(value, '$.name'),
    json_extract(value, '$.type'),
    json_extract(value, '$.icon'),
    json_extract(value, '$.color'),
    json_extract(value, '$.isActive'),
    json_extract(value, '$.sortOrder'),
    json_extract(value, '$.localizationKey'),
    json_extract(value, '$.monthlyPlanMinor'),
    json_extract(value, '$.createdAt'),
    json_extract(value, '$.updatedAt')
  FROM json_each(?)
`

const recurringRuleInsert = `
  INSERT INTO recurring_rules(
    id, name, type, amount_minor, currency, account_id, category_id, frequency,
    schedule_starts_on, schedule_ends_on, next_occurrence_on, last_occurrence_on, anchor_day, is_active,
    payee, note, generated_count, last_error_code, last_error_at, revision, cursor_version,
    deleted_at, created_at, updated_at
  )
  SELECT
    json_extract(value, '$.id'),
    json_extract(value, '$.name'),
    json_extract(value, '$.type'),
    json_extract(value, '$.amountMinor'),
    json_extract(value, '$.currency'),
    json_extract(value, '$.accountId'),
    json_extract(value, '$.categoryId'),
    json_extract(value, '$.frequency'),
    json_extract(value, '$.scheduleStartsOn'),
    json_extract(value, '$.scheduleEndsOn'),
    json_extract(value, '$.nextOccurrenceOn'),
    json_extract(value, '$.lastOccurrenceOn'),
    json_extract(value, '$.anchorDay'),
    json_extract(value, '$.isActive'),
    json_extract(value, '$.payee'),
    json_extract(value, '$.note'),
    json_extract(value, '$.generatedCount'),
    json_extract(value, '$.lastErrorCode'),
    json_extract(value, '$.lastErrorAt'),
    json_extract(value, '$.revision'),
    json_extract(value, '$.cursorVersion'),
    json_extract(value, '$.deletedAt'),
    json_extract(value, '$.createdAt'),
    json_extract(value, '$.updatedAt')
  FROM json_each(?)
`

const recurringTransferRuleInsert = `
  INSERT INTO recurring_transfer_rules(
    id, name, amount_minor, currency, from_account_id, to_account_id, frequency,
    schedule_starts_on, schedule_ends_on, next_occurrence_on, last_occurrence_on,
    anchor_day, is_active, note, generated_count, last_error_code, last_error_at,
    revision, cursor_version, deleted_at, created_at, updated_at
  )
  SELECT
    json_extract(value, '$.id'),
    json_extract(value, '$.name'),
    json_extract(value, '$.amountMinor'),
    json_extract(value, '$.currency'),
    json_extract(value, '$.fromAccountId'),
    json_extract(value, '$.toAccountId'),
    json_extract(value, '$.frequency'),
    json_extract(value, '$.scheduleStartsOn'),
    json_extract(value, '$.scheduleEndsOn'),
    json_extract(value, '$.nextOccurrenceOn'),
    json_extract(value, '$.lastOccurrenceOn'),
    json_extract(value, '$.anchorDay'),
    json_extract(value, '$.isActive'),
    json_extract(value, '$.note'),
    json_extract(value, '$.generatedCount'),
    json_extract(value, '$.lastErrorCode'),
    json_extract(value, '$.lastErrorAt'),
    json_extract(value, '$.revision'),
    json_extract(value, '$.cursorVersion'),
    json_extract(value, '$.deletedAt'),
    json_extract(value, '$.createdAt'),
    json_extract(value, '$.updatedAt')
  FROM json_each(?)
`

const transactionInsert = `
  INSERT INTO transactions(
    id, type, amount_minor, currency, account_id, category_id, occurred_on, cleared,
    import_review_status, payee, note,
    recurring_rule_id, recurring_rule_name, recurrence_due_on, recurring_occurrence_key,
    created_at, updated_at
  )
  SELECT
    json_extract(value, '$.id'),
    json_extract(value, '$.type'),
    json_extract(value, '$.amountMinor'),
    json_extract(value, '$.currency'),
    json_extract(value, '$.accountId'),
    json_extract(value, '$.categoryId'),
    json_extract(value, '$.occurredOn'),
    json_extract(value, '$.cleared'),
    json_extract(value, '$.importReviewStatus'),
    json_extract(value, '$.payee'),
    json_extract(value, '$.note'),
    json_extract(value, '$.recurringRuleId'),
    json_extract(value, '$.recurringRuleName'),
    json_extract(value, '$.recurrenceDueOn'),
    json_extract(value, '$.recurringOccurrenceKey'),
    json_extract(value, '$.createdAt'),
    json_extract(value, '$.updatedAt')
  FROM json_each(?)
`

const accountTransferInsert = `
  INSERT INTO account_transfers(
    id, amount_minor, currency, from_account_id, to_account_id, occurred_on,
    from_cleared, to_cleared, note, recurring_transfer_rule_id,
    recurring_transfer_rule_name, recurrence_due_on, recurring_occurrence_key,
    created_at, updated_at
  )
  SELECT
    json_extract(value, '$.id'),
    json_extract(value, '$.amountMinor'),
    json_extract(value, '$.currency'),
    json_extract(value, '$.fromAccountId'),
    json_extract(value, '$.toAccountId'),
    json_extract(value, '$.occurredOn'),
    json_extract(value, '$.fromCleared'),
    json_extract(value, '$.toCleared'),
    json_extract(value, '$.note'),
    json_extract(value, '$.recurringTransferRuleId'),
    json_extract(value, '$.recurringTransferRuleName'),
    json_extract(value, '$.recurrenceDueOn'),
    json_extract(value, '$.recurringOccurrenceKey'),
    json_extract(value, '$.createdAt'),
    json_extract(value, '$.updatedAt')
  FROM json_each(?)
`

const emergencyFundGoalInsert = `
  INSERT INTO emergency_fund_goals(id, account_id, target_minor, created_at, updated_at)
  SELECT
    json_extract(value, '$.id'),
    json_extract(value, '$.accountId'),
    json_extract(value, '$.targetMinor'),
    json_extract(value, '$.createdAt'),
    json_extract(value, '$.updatedAt')
  FROM json_each(?)
`

const importKeyInsert = `
  INSERT INTO transaction_import_keys(import_key, transaction_id, imported_at)
  SELECT
    json_extract(value, '$.importKey'),
    json_extract(value, '$.transactionId'),
    json_extract(value, '$.importedAt')
  FROM json_each(?)
`

const ecbReferenceRateInsert = `
  INSERT INTO ecb_reference_rates(
    source, base_currency, quote_currency, observed_on, rate, fetched_at
  )
  SELECT
    'ecb',
    'EUR',
    json_extract(value, '$.quoteCurrency'),
    json_extract(value, '$.observedOn'),
    json_extract(value, '$.rate'),
    json_extract(value, '$.fetchedAt')
  FROM json_each(?)
`

const countQuery = `
  SELECT
    (SELECT COUNT(*) FROM accounts) AS accounts,
    (SELECT COUNT(*) FROM categories) AS categories,
    (SELECT COUNT(*) FROM recurring_rules) AS recurringRules,
    (SELECT COUNT(*) FROM recurring_transfer_rules) AS recurringTransferRules,
    (SELECT COUNT(*) FROM transactions) AS transactions,
    (SELECT COUNT(*) FROM account_transfers) AS accountTransfers,
    (SELECT COUNT(*) FROM emergency_fund_goals) AS emergencyFundGoals,
    (SELECT COUNT(*) FROM transaction_import_keys) AS transactionImportKeys,
    (SELECT COUNT(*) FROM ecb_reference_rates) AS ecbReferenceRates
`

const countGuardQuery = `
  WITH counts AS (
    ${countQuery}
  )
  INSERT INTO transaction_import_keys(import_key, transaction_id, imported_at)
  SELECT
    'invalid',
    '00000000-0000-4000-8000-000000000000',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM counts
  WHERE
    accounts <> ?
    OR categories <> ?
    OR recurringRules <> ?
    OR recurringTransferRules <> ?
    OR transactions <> ?
    OR accountTransfers <> ?
    OR emergencyFundGoals <> ?
    OR transactionImportKeys <> ?
    OR ecbReferenceRates <> ?
`

export async function exportLedgerBackup(
  database: D1Database,
  exportedAt = new Date().toISOString(),
): Promise<LedgerBackup> {
  const snapshot = await loadLedgerSnapshot(database)
  const issues = validateLedgerDataRelations(snapshot.data)
  if (issues.length > 0) throw new Error(`Ledger cannot be exported: ${issues[0]?.message}`)

  const payload = ledgerBackupPayloadSchema.parse({
    format: LEDGER_BACKUP_FORMAT,
    version: LEDGER_BACKUP_VERSION,
    exportedAt,
    schemaVersion: LEDGER_SCHEMA_VERSION,
    data: snapshot.data,
  })
  return {
    ...payload,
    checksum: {
      algorithm: 'SHA-256',
      digest: await checksumLedgerBackupPayload(payload),
    },
  }
}

export async function verifyLedgerBackup(
  backup: CompatibleLedgerBackup,
): Promise<LedgerBackupVerification> {
  const payload = backupPayload(backup)
  const digest = await checksumLedgerBackupPayload(payload)
  if (digest !== backup.checksum.digest) {
    return {
      ok: false,
      code: 'BACKUP_CHECKSUM_MISMATCH',
      issues: [{ path: 'backup.checksum.digest', message: 'Checksum does not match the backup contents' }],
    }
  }

  const data = upgradeLedgerBackupData(backup)
  const issues = validateLedgerDataRelations(data)
  if (issues.length > 0) return { ok: false, code: 'BACKUP_DATA_INVALID', issues }

  const chunks = createRestoreChunks(data)
  const restoreStatements = countRestoreStatements(chunks)
  if (restoreStatements > MAX_LEDGER_RESTORE_BATCH_STATEMENTS) {
    return {
      ok: false,
      code: 'BACKUP_RESTORE_TOO_LARGE',
      issues: [{
        path: 'backup.data',
        message: `Restore requires ${restoreStatements} statements; the safe limit is ${MAX_LEDGER_RESTORE_BATCH_STATEMENTS}`,
      }],
    }
  }

  return {
    ok: true,
    value: {
      exportedAt: backup.exportedAt,
      currency: data.currency,
      checksum: backup.checksum.digest,
      backupDigest: await digestLedgerData(data),
      backupCounts: countLedgerData(data),
      chunks,
      restoreStatements,
    },
  }
}

export async function previewLedgerRestore(
  database: D1Database,
  verified: VerifiedLedgerBackup,
): Promise<LedgerRestorePreview> {
  const current = await loadLedgerSnapshot(database)
  return {
    exportedAt: verified.exportedAt,
    checksum: verified.checksum,
    backupDigest: verified.backupDigest,
    currentDigest: await digestLedgerData(current.data),
    currentRevision: current.revision,
    currentCurrency: current.data.currency,
    backupCurrency: verified.currency,
    currentCounts: countLedgerData(current.data),
    backupCounts: verified.backupCounts,
    restoreStatements: verified.restoreStatements,
  }
}

export async function restoreLedgerBackup(
  database: D1Database,
  verified: VerifiedLedgerBackup,
  expectedCurrentDigest: string,
  expectedRevision: number,
): Promise<LedgerRestoreResult> {
  const current = await loadLedgerSnapshot(database)
  if (
    current.revision !== expectedRevision ||
    await digestLedgerData(current.data) !== expectedCurrentDigest
  ) {
    return { ok: false, code: 'BACKUP_PREVIEW_STALE' }
  }

  const statements = buildRestoreStatements(
    database,
    verified.chunks,
    verified.currency,
    expectedRevision,
    verified.backupCounts,
  )
  try {
    const results = await database.batch<LedgerTableCounts>(statements)
    const counts = results.at(-1)?.results[0]
    if (!counts || !sameCounts(counts, verified.backupCounts)) {
      throw new Error('Ledger restore count verification failed')
    }
    return {
      ok: true,
      value: {
        restoredAt: new Date().toISOString(),
        backupDigest: verified.backupDigest,
        counts,
      },
    }
  } catch (error) {
    if (isStaleRevisionError(error)) return { ok: false, code: 'BACKUP_PREVIEW_STALE' }
    throw error
  }
}

export function createRestoreChunks(data: LedgerBackupData): LedgerRestoreChunks {
  return {
    accounts: chunkRows(data.accounts),
    categories: chunkRows(data.categories),
    recurringRules: chunkRows(data.recurringRules),
    recurringTransferRules: chunkRows(data.recurringTransferRules),
    transactions: chunkRows(data.transactions),
    accountTransfers: chunkRows(data.accountTransfers),
    emergencyFundGoals: chunkRows(data.emergencyFundGoals),
    transactionImportKeys: chunkRows(data.transactionImportKeys),
    ecbReferenceRates: chunkRows(data.ecbReferenceRates),
  }
}

export function countRestoreStatements(chunks: LedgerRestoreChunks) {
  return 13 + Object.values(chunks).reduce((total, tableChunks) => total + tableChunks.length, 0)
}

async function loadLedgerSnapshot(database: D1Database): Promise<LedgerSnapshot> {
  const [
    accounts,
    categories,
    recurringRules,
    recurringTransferRules,
    transactions,
    accountTransfers,
    emergencyFundGoals,
    importKeys,
    ecbReferenceRates,
    ledgerSettings,
    revision,
  ] =
    await database.batch([
      database.prepare(accountQuery),
      database.prepare(categoryQuery),
      database.prepare(recurringRuleQuery),
      database.prepare(recurringTransferRuleQuery),
      database.prepare(transactionQuery),
      database.prepare(accountTransferQuery),
      database.prepare(emergencyFundGoalQuery),
      database.prepare(importKeyQuery),
      database.prepare(ecbReferenceRateQuery),
      database.prepare(ledgerSettingsQuery),
      database.prepare(revisionQuery),
    ])

  const revisionRow = revision.results[0] as LedgerRevisionRow | undefined
  if (!revisionRow) throw new Error('Ledger revision state is missing')
  const ledgerSettingsRow = ledgerSettings.results[0] as LedgerSettingsRow | undefined
  if (!ledgerSettingsRow) throw new Error('Ledger currency setting is missing')

  const data = ledgerBackupDataSchema.parse({
    currency: ledgerSettingsRow.currency,
    accounts: (accounts.results as RawAccount[]).map((row) => ({
      ...row,
      isActive: row.isActive === 1,
    })),
    categories: (categories.results as RawCategory[]).map((row) => ({
      ...row,
      isActive: row.isActive === 1,
    })),
    recurringRules: (recurringRules.results as RawRecurringRule[]).map((row) => ({
      ...row,
      isActive: row.isActive === 1,
    })),
    recurringTransferRules: (
      recurringTransferRules.results as RawRecurringTransferRule[]
    ).map((row) => ({ ...row, isActive: row.isActive === 1 })),
    transactions: (transactions.results as RawTransaction[]).map((row) => ({
      ...row,
      cleared: row.cleared === 1,
    })),
    accountTransfers: (accountTransfers.results as RawAccountTransfer[]).map((row) => ({
      ...row,
      fromCleared: row.fromCleared === 1,
      toCleared: row.toCleared === 1,
    })),
    emergencyFundGoals: emergencyFundGoals.results,
    transactionImportKeys: importKeys.results,
    ecbReferenceRates: ecbReferenceRates.results as RawEcbReferenceRate[],
  })

  return { data, revision: revisionRow.revision }
}

function backupPayload(
  backup: CompatibleLedgerBackup,
): CompatibleLedgerBackupPayload {
  return compatibleLedgerBackupPayloadSchema.parse({
    format: backup.format,
    version: backup.version,
    exportedAt: backup.exportedAt,
    schemaVersion: backup.schemaVersion,
    data: backup.data,
  })
}

function chunkRows<T>(rows: readonly T[]) {
  const encoder = new TextEncoder()
  const chunks: string[] = []
  let current: string[] = []
  let currentBytes = 2

  for (const row of rows) {
    const serialized = JSON.stringify(row)
    const rowBytes = encoder.encode(serialized).byteLength
    if (rowBytes + 2 > LEDGER_RESTORE_CHUNK_BYTES) {
      throw new Error('A ledger row is too large to restore safely')
    }

    const nextBytes = currentBytes + rowBytes + (current.length > 0 ? 1 : 0)
    if (current.length > 0 && nextBytes > LEDGER_RESTORE_CHUNK_BYTES) {
      chunks.push(`[${current.join(',')}]`)
      current = []
      currentBytes = 2
    }

    current.push(serialized)
    currentBytes += rowBytes + (current.length > 1 ? 1 : 0)
  }

  if (current.length > 0) chunks.push(`[${current.join(',')}]`)
  return chunks
}

function buildRestoreStatements(
  database: D1Database,
  chunks: LedgerRestoreChunks,
  currency: SupportedCurrency,
  expectedRevision: number,
  expectedCounts: LedgerTableCounts,
) {
  const statements: D1PreparedStatement[] = [
    database.prepare(`
      INSERT INTO ledger_state(id, revision, updated_at)
      SELECT 1, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE COALESCE((SELECT revision FROM ledger_state WHERE id = 1), -1) <> ?
    `).bind(expectedRevision, expectedRevision),
    database.prepare('DELETE FROM transaction_import_keys'),
    database.prepare('DELETE FROM ecb_reference_rates'),
    database.prepare('DELETE FROM transactions'),
    database.prepare('DELETE FROM account_transfers'),
    database.prepare('DELETE FROM recurring_transfer_rules'),
    database.prepare('DELETE FROM recurring_rules'),
    database.prepare('DELETE FROM emergency_fund_goals'),
    database.prepare('DELETE FROM categories'),
    database.prepare('DELETE FROM accounts'),
    database.prepare(`
      UPDATE ledger_settings
      SET currency = ?, updated_at = ${nextLedgerSettingsUpdatedAt}
      WHERE id = 1
    `).bind(currency),
  ]

  appendChunkStatements(statements, database, accountInsert, chunks.accounts)
  appendChunkStatements(statements, database, emergencyFundGoalInsert, chunks.emergencyFundGoals)
  appendChunkStatements(statements, database, categoryInsert, chunks.categories)
  appendChunkStatements(statements, database, recurringRuleInsert, chunks.recurringRules)
  appendChunkStatements(
    statements,
    database,
    recurringTransferRuleInsert,
    chunks.recurringTransferRules,
  )
  appendChunkStatements(statements, database, transactionInsert, chunks.transactions)
  appendChunkStatements(statements, database, accountTransferInsert, chunks.accountTransfers)
  appendChunkStatements(statements, database, importKeyInsert, chunks.transactionImportKeys)
  appendChunkStatements(statements, database, ecbReferenceRateInsert, chunks.ecbReferenceRates)
  statements.push(database.prepare(countGuardQuery).bind(
    expectedCounts.accounts,
    expectedCounts.categories,
    expectedCounts.recurringRules,
    expectedCounts.recurringTransferRules,
    expectedCounts.transactions,
    expectedCounts.accountTransfers,
    expectedCounts.emergencyFundGoals,
    expectedCounts.transactionImportKeys,
    expectedCounts.ecbReferenceRates,
  ))
  statements.push(database.prepare(countQuery))
  return statements
}

function appendChunkStatements(
  statements: D1PreparedStatement[],
  database: D1Database,
  sql: string,
  chunks: readonly string[],
) {
  for (const chunk of chunks) statements.push(database.prepare(sql).bind(chunk))
}

function sameCounts(left: LedgerTableCounts, right: LedgerTableCounts) {
  return (
    left.accounts === right.accounts &&
    left.categories === right.categories &&
    left.recurringRules === right.recurringRules &&
    left.recurringTransferRules === right.recurringTransferRules &&
    left.transactions === right.transactions &&
    left.accountTransfers === right.accountTransfers &&
    left.emergencyFundGoals === right.emergencyFundGoals &&
    left.transactionImportKeys === right.transactionImportKeys &&
    left.ecbReferenceRates === right.ecbReferenceRates
  )
}

function isStaleRevisionError(error: unknown) {
  return /(?:UNIQUE constraint failed: ledger_state\.id|ledger_state\.id.*UNIQUE)/i.test(
    error instanceof Error ? error.message : String(error),
  )
}
