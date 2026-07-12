import 'server-only'

import type {
  CsvImportCommitResult,
  CsvImportPreviewResult,
  CsvImportRow,
  CsvImportRowStatus,
} from '../lib/csvImport'

type ClassificationRow = {
  importKeyExists: number
  idExists: number
  idMatches: number
  exactMatches: number
  accountExists: number
  accountActive: number
  categoryExists: number
  categoryMatches: number
  categoryActive: number
}

export type CsvImportCommitOutcome =
  | { kind: 'committed'; result: CsvImportCommitResult }
  | { kind: 'blocked'; preview: CsvImportPreviewResult }

const classificationSql = `
  WITH candidate(
    import_key,
    id,
    type,
    amount_minor,
    currency,
    account_id,
    category_id,
    occurred_on,
    payee,
    note
  ) AS (VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?))
  SELECT
    EXISTS(
      SELECT 1 FROM transaction_import_keys tik
      WHERE tik.import_key = candidate.import_key
    ) AS importKeyExists,
    EXISTS(
      SELECT 1 FROM transactions t
      WHERE t.id = candidate.id
    ) AS idExists,
    EXISTS(
      SELECT 1 FROM transactions t
      WHERE t.id = candidate.id
        AND t.type = candidate.type
        AND t.amount_minor = candidate.amount_minor
        AND t.currency = candidate.currency
        AND t.account_id = candidate.account_id
        AND t.category_id = candidate.category_id
        AND t.occurred_on = candidate.occurred_on
        AND t.payee = candidate.payee
        AND t.note = candidate.note
    ) AS idMatches,
    EXISTS(
      SELECT 1 FROM transactions t
      WHERE t.type = candidate.type
        AND t.amount_minor = candidate.amount_minor
        AND t.currency = candidate.currency
        AND t.account_id = candidate.account_id
        AND t.category_id = candidate.category_id
        AND t.occurred_on = candidate.occurred_on
        AND t.payee = candidate.payee
        AND t.note = candidate.note
    ) AS exactMatches,
    EXISTS(
      SELECT 1 FROM accounts account
      WHERE account.id = candidate.account_id
        AND account.currency = candidate.currency
    ) AS accountExists,
    EXISTS(
      SELECT 1 FROM accounts account
      WHERE account.id = candidate.account_id
        AND account.currency = candidate.currency
        AND account.is_active = 1
    ) AS accountActive,
    EXISTS(
      SELECT 1 FROM categories category
      WHERE category.id = candidate.category_id
    ) AS categoryExists,
    EXISTS(
      SELECT 1 FROM categories category
      WHERE category.id = candidate.category_id
        AND category.type = candidate.type
    ) AS categoryMatches,
    EXISTS(
      SELECT 1 FROM categories category
      WHERE category.id = candidate.category_id
        AND category.is_active = 1
    ) AS categoryActive
  FROM candidate
`

export async function previewCsvImport(
  database: D1Database,
  rows: readonly CsvImportRow[],
): Promise<CsvImportPreviewResult> {
  const statement = database.prepare(classificationSql)
  const results = await database.batch(
    rows.map((row) => bindRow(statement, row)),
  )
  const previewRows = results.map((result, index) => {
    const classification = result.results[0] as ClassificationRow | undefined
    if (!classification) throw new Error('CSV import classification returned no row')
    return {
      sourceRow: rows[index].sourceRow,
      importKey: rows[index].importKey,
      status: classify(classification),
    }
  })

  return summarize(previewRows)
}

export async function commitCsvImport(
  database: D1Database,
  rows: readonly CsvImportRow[],
): Promise<CsvImportCommitOutcome> {
  const preview = await previewCsvImport(database, rows)
  const statusByKey = new Map(preview.rows.map((row) => [row.importKey, row.status]))
  const includedBlocker = rows.some((row) => row.include && isBlocked(statusByKey.get(row.importKey)))
  if (includedBlocker) return { kind: 'blocked', preview }

  const eligible = rows.filter((row) => {
    if (!row.include) return false
    const status = statusByKey.get(row.importKey)
    return status === 'new' || status === 'possible_duplicate'
  })
  if (eligible.length === 0) {
    return {
      kind: 'committed',
      result: { ...preview, imported: 0, staleSkipped: 0 },
    }
  }

  const insertTransaction = database.prepare(`
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
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE EXISTS (
      SELECT 1 FROM accounts
      WHERE id = ? AND currency = ? AND is_active = 1
    )
      AND EXISTS (
        SELECT 1 FROM categories
        WHERE id = ? AND type = ? AND is_active = 1
      )
    ON CONFLICT(id) DO NOTHING
  `)
  const insertImportKey = database.prepare(`
    INSERT INTO transaction_import_keys(import_key, transaction_id)
    SELECT ?, ?
    WHERE EXISTS (
      SELECT 1 FROM transactions
      WHERE id = ?
        AND type = ?
        AND amount_minor = ?
        AND currency = ?
        AND account_id = ?
        AND category_id = ?
        AND occurred_on = ?
        AND payee = ?
        AND note = ?
    )
  `)
  const statements = eligible.flatMap((row) => [
    insertTransaction.bind(
      row.id,
      row.type,
      row.amountMinor,
      row.currency,
      row.accountId,
      row.categoryId,
      row.occurredOn,
      row.payee,
      row.note,
      row.accountId,
      row.currency,
      row.categoryId,
      row.type,
    ),
    insertImportKey.bind(
      row.importKey,
      row.id,
      row.id,
      row.type,
      row.amountMinor,
      row.currency,
      row.accountId,
      row.categoryId,
      row.occurredOn,
      row.payee,
      row.note,
    ),
  ])
  const results = await database.batch(statements)
  const imported = eligible.reduce(
    (count, _row, index) => count + Number(results[index * 2].meta.changes ?? 0),
    0,
  )

  return {
    kind: 'committed',
    result: {
      ...preview,
      imported,
      staleSkipped: eligible.length - imported,
    },
  }
}

function bindRow(statement: D1PreparedStatement, row: CsvImportRow) {
  return statement.bind(
    row.importKey,
    row.id,
    row.type,
    row.amountMinor,
    row.currency,
    row.accountId,
    row.categoryId,
    row.occurredOn,
    row.payee,
    row.note,
  )
}

function classify(row: ClassificationRow): CsvImportRowStatus {
  if (row.importKeyExists) return 'already_imported'
  if (row.idExists) return row.idMatches ? 'existing_transaction' : 'id_conflict'
  if (!row.accountExists || !row.accountActive) return 'account_invalid'
  if (!row.categoryExists || !row.categoryActive) return 'category_invalid'
  if (!row.categoryMatches) return 'category_mismatch'
  if (row.exactMatches) return 'possible_duplicate'
  return 'new'
}

function isBlocked(status: CsvImportRowStatus | undefined) {
  return status === 'id_conflict' ||
    status === 'account_invalid' ||
    status === 'category_invalid' ||
    status === 'category_mismatch'
}

function summarize(rows: CsvImportPreviewResult['rows']): CsvImportPreviewResult {
  return {
    rows,
    ready: rows.filter((row) => row.status === 'new').length,
    possibleDuplicates: rows.filter((row) => row.status === 'possible_duplicate').length,
    skipped: rows.filter(
      (row) => row.status === 'already_imported' || row.status === 'existing_transaction',
    ).length,
    blocked: rows.filter((row) => isBlocked(row.status)).length,
  }
}
