import 'server-only'

import {
  LEDGER_BACKUP_FORMAT,
  LEDGER_BACKUP_VERSION,
  LEDGER_RESTORE_CHUNK_BYTES,
  LEDGER_SCHEMA_VERSION,
  MAX_LEDGER_RESTORE_BATCH_STATEMENTS,
  checksumLedgerBackupPayload,
  countLedgerData,
  digestLedgerData,
  ledgerBackupDataSchema,
  ledgerBackupPayloadSchema,
  validateLedgerDataRelations,
  type LedgerBackup,
  type LedgerBackupData,
  type LedgerBackupPayload,
  type LedgerRestoreCommitResult,
  type LedgerRestorePreview,
  type LedgerTableCounts,
  type LedgerValidationIssue,
} from '../lib/ledgerBackup'

type RawAccount = Omit<LedgerBackupData['accounts'][number], 'isActive'> & { isActive: number }
type RawCategory = Omit<LedgerBackupData['categories'][number], 'isActive'> & { isActive: number }
type RawRecurringRule = Omit<LedgerBackupData['recurringRules'][number], 'isActive'> & { isActive: number }
type LedgerRevisionRow = { revision: number }

type LedgerSnapshot = {
  data: LedgerBackupData
  revision: number
}

export type VerifiedLedgerBackup = {
  backup: LedgerBackup
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
  transactions: string[]
  transactionImportKeys: string[]
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

const transactionQuery = `
  SELECT
    id,
    type,
    amount_minor AS amountMinor,
    currency,
    account_id AS accountId,
    category_id AS categoryId,
    occurred_on AS occurredOn,
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

const importKeyQuery = `
  SELECT
    import_key AS importKey,
    transaction_id AS transactionId,
    imported_at AS importedAt
  FROM transaction_import_keys
  ORDER BY import_key ASC
`

const revisionQuery = 'SELECT revision FROM ledger_state WHERE id = 1'

const accountInsert = `
  INSERT INTO accounts(
    id, name, type, currency, is_active, sort_order, localization_key, created_at, updated_at
  )
  SELECT
    json_extract(value, '$.id'),
    json_extract(value, '$.name'),
    json_extract(value, '$.type'),
    json_extract(value, '$.currency'),
    json_extract(value, '$.isActive'),
    json_extract(value, '$.sortOrder'),
    json_extract(value, '$.localizationKey'),
    json_extract(value, '$.createdAt'),
    json_extract(value, '$.updatedAt')
  FROM json_each(?)
`

const categoryInsert = `
  INSERT INTO categories(
    id, name, type, icon, color, is_active, sort_order, localization_key, created_at, updated_at
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
    json_extract(value, '$.createdAt'),
    json_extract(value, '$.updatedAt')
  FROM json_each(?)
`

const recurringRuleInsert = `
  INSERT INTO recurring_rules(
    id, name, type, amount_minor, currency, account_id, category_id, frequency,
    schedule_starts_on, next_occurrence_on, last_occurrence_on, anchor_day, is_active,
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

const transactionInsert = `
  INSERT INTO transactions(
    id, type, amount_minor, currency, account_id, category_id, occurred_on, payee, note,
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

const importKeyInsert = `
  INSERT INTO transaction_import_keys(import_key, transaction_id, imported_at)
  SELECT
    json_extract(value, '$.importKey'),
    json_extract(value, '$.transactionId'),
    json_extract(value, '$.importedAt')
  FROM json_each(?)
`

const countQuery = `
  SELECT
    (SELECT COUNT(*) FROM accounts) AS accounts,
    (SELECT COUNT(*) FROM categories) AS categories,
    (SELECT COUNT(*) FROM recurring_rules) AS recurringRules,
    (SELECT COUNT(*) FROM transactions) AS transactions,
    (SELECT COUNT(*) FROM transaction_import_keys) AS transactionImportKeys
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
    OR transactions <> ?
    OR transactionImportKeys <> ?
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

export async function verifyLedgerBackup(backup: LedgerBackup): Promise<LedgerBackupVerification> {
  const payload = backupPayload(backup)
  const digest = await checksumLedgerBackupPayload(payload)
  if (digest !== backup.checksum.digest) {
    return {
      ok: false,
      code: 'BACKUP_CHECKSUM_MISMATCH',
      issues: [{ path: 'backup.checksum.digest', message: 'Checksum does not match the backup contents' }],
    }
  }

  const issues = validateLedgerDataRelations(backup.data)
  if (issues.length > 0) return { ok: false, code: 'BACKUP_DATA_INVALID', issues }

  const chunks = createRestoreChunks(backup.data)
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
      backup,
      backupDigest: await digestLedgerData(backup.data),
      backupCounts: countLedgerData(backup.data),
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
    exportedAt: verified.backup.exportedAt,
    checksum: verified.backup.checksum.digest,
    backupDigest: verified.backupDigest,
    currentDigest: await digestLedgerData(current.data),
    currentRevision: current.revision,
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
    transactions: chunkRows(data.transactions),
    transactionImportKeys: chunkRows(data.transactionImportKeys),
  }
}

export function countRestoreStatements(chunks: LedgerRestoreChunks) {
  return 8 + Object.values(chunks).reduce((total, tableChunks) => total + tableChunks.length, 0)
}

async function loadLedgerSnapshot(database: D1Database): Promise<LedgerSnapshot> {
  const [accounts, categories, recurringRules, transactions, importKeys, revision] =
    await database.batch([
      database.prepare(accountQuery),
      database.prepare(categoryQuery),
      database.prepare(recurringRuleQuery),
      database.prepare(transactionQuery),
      database.prepare(importKeyQuery),
      database.prepare(revisionQuery),
    ])

  const revisionRow = revision.results[0] as LedgerRevisionRow | undefined
  if (!revisionRow) throw new Error('Ledger revision state is missing')

  const data = ledgerBackupDataSchema.parse({
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
    transactions: transactions.results,
    transactionImportKeys: importKeys.results,
  })

  return { data, revision: revisionRow.revision }
}

function backupPayload(backup: LedgerBackup): LedgerBackupPayload {
  return ledgerBackupPayloadSchema.parse({
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
    database.prepare('DELETE FROM transactions'),
    database.prepare('DELETE FROM recurring_rules'),
    database.prepare('DELETE FROM categories'),
    database.prepare('DELETE FROM accounts'),
  ]

  appendChunkStatements(statements, database, accountInsert, chunks.accounts)
  appendChunkStatements(statements, database, categoryInsert, chunks.categories)
  appendChunkStatements(statements, database, recurringRuleInsert, chunks.recurringRules)
  appendChunkStatements(statements, database, transactionInsert, chunks.transactions)
  appendChunkStatements(statements, database, importKeyInsert, chunks.transactionImportKeys)
  statements.push(database.prepare(countGuardQuery).bind(
    expectedCounts.accounts,
    expectedCounts.categories,
    expectedCounts.recurringRules,
    expectedCounts.transactions,
    expectedCounts.transactionImportKeys,
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
    left.transactions === right.transactions &&
    left.transactionImportKeys === right.transactionImportKeys
  )
}

function isStaleRevisionError(error: unknown) {
  return /(?:UNIQUE constraint failed: ledger_state\.id|ledger_state\.id.*UNIQUE)/i.test(
    error instanceof Error ? error.message : String(error),
  )
}
