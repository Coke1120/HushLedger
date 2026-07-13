import 'server-only'

import type {
  TransactionImportCommitResult,
  TransactionImportPreviewResult,
  TransactionImportRow,
  TransactionImportRowStatus,
} from '../lib/transactionImport'
import type { TransactionDuplicateCheckInput } from '../lib/schema'

type ClassificationRow = {
  importKeyExists: number
  idExists: number
  idMatches: number
  exactMatchCount: number
  unclearedExactMatchCount: number
  accountExists: number
  accountActive: number
  categoryExists: number
  categoryMatches: number
  categoryActive: number
}

export type TransactionImportCommitOutcome =
  | { kind: 'committed'; result: TransactionImportCommitResult }
  | { kind: 'blocked'; preview: TransactionImportPreviewResult }

const exactTransactionMatchPredicate = `
  t.type = candidate.type
  AND t.amount_minor = candidate.amount_minor
  AND t.currency = candidate.currency
  AND t.account_id = candidate.account_id
  AND t.category_id = candidate.category_id
  AND t.occurred_on = candidate.occurred_on
  AND t.payee = candidate.payee
  AND t.note = candidate.note
`

export async function countExactTransactionMatches(
  database: D1Database,
  input: TransactionDuplicateCheckInput,
) {
  const row = await database.prepare(`
    WITH candidate(
      type,
      amount_minor,
      currency,
      account_id,
      category_id,
      occurred_on,
      payee,
      note
    ) AS (VALUES (?, ?, ?, ?, ?, ?, ?, ?))
    SELECT COUNT(*) AS matchCount
    FROM transactions t, candidate
    WHERE ${exactTransactionMatchPredicate}
      AND (? IS NULL OR t.id <> ?)
  `)
    .bind(
      input.type,
      input.amountMinor,
      input.currency,
      input.accountId,
      input.categoryId,
      input.occurredOn,
      input.payee,
      input.note,
      input.excludeId ?? null,
      input.excludeId ?? null,
    )
    .first<{ matchCount: number }>()

  return row?.matchCount ?? 0
}

const importClassificationSql = `
  WITH candidate(
    import_key,
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
  ) AS (VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?))
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
        AND t.cleared = candidate.cleared
        AND t.payee = candidate.payee
        AND t.note = candidate.note
    ) AS idMatches,
    (
      SELECT COUNT(*) FROM transactions t
      WHERE ${exactTransactionMatchPredicate}
    ) AS exactMatchCount,
    (
      SELECT COUNT(*) FROM transactions t
      WHERE ${exactTransactionMatchPredicate}
        AND t.cleared = 0
    ) AS unclearedExactMatchCount,
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

export async function previewTransactionImport(
  database: D1Database,
  rows: readonly TransactionImportRow[],
): Promise<TransactionImportPreviewResult> {
  const statement = database.prepare(importClassificationSql)
  const results = await database.batch(
    rows.map((row) => bindRow(statement, row)),
  )
  const previewRows = results.map((result, index) => {
    const classification = result.results[0] as ClassificationRow | undefined
    if (!classification) throw new Error('Transaction import classification returned no row')
    return {
      sourceRow: rows[index].sourceRow,
      importKey: rows[index].importKey,
      status: classify(classification, rows[index].cleared),
    }
  })

  return summarize(previewRows)
}

export async function commitTransactionImport(
  database: D1Database,
  rows: readonly TransactionImportRow[],
): Promise<TransactionImportCommitOutcome> {
  const preview = await previewTransactionImport(database, rows)
  const statusByKey = new Map(preview.rows.map((row) => [row.importKey, row.status]))
  const includedBlocker = rows.some((row) => row.include && isBlocked(statusByKey.get(row.importKey)))
  if (includedBlocker) return { kind: 'blocked', preview }

  const eligible = rows.filter((row) => {
    if (!row.include) return false
    const status = statusByKey.get(row.importKey)
    return status === 'new' || status === 'match_ready' || status === 'possible_duplicate'
  })
  if (eligible.length === 0) {
    return {
      kind: 'committed',
      result: { ...preview, imported: 0, matched: 0, staleSkipped: 0 },
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
      cleared,
      payee,
      note
    )
    SELECT
      ?,
      ?,
      CASE
        WHEN EXISTS (
          SELECT 1 FROM accounts
          WHERE id = ? AND currency = ? AND is_active = 1
        )
          AND EXISTS (
            SELECT 1 FROM categories
            WHERE id = ? AND type = ? AND is_active = 1
          )
        THEN ?
        ELSE 0
      END,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?
    RETURNING id
  `)
  const insertImportKey = database.prepare(`
    INSERT INTO transaction_import_keys(import_key, transaction_id) VALUES (?, ?)
  `)
  const insertMatchedImportKey = database.prepare(`
    WITH candidate(
      import_key,
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
    ) AS (VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)),
    matches AS (
      SELECT t.id, t.cleared
      FROM transactions t, candidate
      WHERE ${exactTransactionMatchPredicate}
    ),
    single_match AS (
      SELECT MIN(id) AS transaction_id
      FROM matches
      HAVING COUNT(*) = 1 AND MIN(cleared) = 0
    )
    INSERT INTO transaction_import_keys(import_key, transaction_id)
    SELECT candidate.import_key, single_match.transaction_id
    FROM candidate, single_match
    WHERE candidate.cleared = 1
    RETURNING transaction_id
  `)
  const clearMatchedTransaction = database.prepare(`
    UPDATE transactions
    SET
      cleared = 1,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE cleared = 0
      AND id = (
        SELECT transaction_id FROM transaction_import_keys WHERE import_key = ?
      )
  `)
  const operations = eligible.map((row) => {
    if (statusByKey.get(row.importKey) === 'match_ready') {
      return {
        kind: 'matched' as const,
        statements: [
          bindRow(insertMatchedImportKey, row),
          clearMatchedTransaction.bind(row.importKey),
        ],
      }
    }
    return {
      kind: 'imported' as const,
      statements: [
        insertTransaction.bind(
          row.id,
          row.type,
          row.accountId,
          row.currency,
          row.categoryId,
          row.type,
          row.amountMinor,
          row.currency,
          row.accountId,
          row.categoryId,
          row.occurredOn,
          row.cleared ? 1 : 0,
          row.payee,
          row.note,
        ),
        insertImportKey.bind(row.importKey, row.id),
      ],
    }
  })
  const results = await database.batch(operations.flatMap((operation) => operation.statements))
  const applied = operations.map((operation, index) => ({
    kind: operation.kind,
    changed: results[index * 2]?.results.length === 1,
  }))
  const imported = applied.filter(
    (operation) => operation.kind === 'imported' && operation.changed,
  ).length
  const matched = applied.filter(
    (operation) => operation.kind === 'matched' && operation.changed,
  ).length

  return {
    kind: 'committed',
    result: {
      ...preview,
      imported,
      matched,
      staleSkipped: eligible.length - imported - matched,
    },
  }
}

export function isTransactionImportConflict(error: unknown) {
  return error instanceof Error &&
    /transaction_import_keys|(?:UNIQUE|CHECK|FOREIGN KEY) constraint|SQLITE_CONSTRAINT/i.test(
      error.message,
    )
}

function bindRow(statement: D1PreparedStatement, row: TransactionImportRow) {
  return statement.bind(
    row.importKey,
    row.id,
    row.type,
    row.amountMinor,
    row.currency,
    row.accountId,
    row.categoryId,
    row.occurredOn,
    row.cleared ? 1 : 0,
    row.payee,
    row.note,
  )
}

function classify(row: ClassificationRow, candidateCleared: boolean): TransactionImportRowStatus {
  if (row.importKeyExists) return 'already_imported'
  if (row.idExists) return row.idMatches ? 'existing_transaction' : 'id_conflict'
  if (!row.accountExists || !row.accountActive) return 'account_invalid'
  if (!row.categoryExists || !row.categoryActive) return 'category_invalid'
  if (!row.categoryMatches) return 'category_mismatch'
  if (candidateCleared && row.exactMatchCount === 1 && row.unclearedExactMatchCount === 1) {
    return 'match_ready'
  }
  if (row.exactMatchCount > 0) return 'possible_duplicate'
  return 'new'
}

function isBlocked(status: TransactionImportRowStatus | undefined) {
  return status === 'id_conflict' ||
    status === 'account_invalid' ||
    status === 'category_invalid' ||
    status === 'category_mismatch'
}

function summarize(
  rows: TransactionImportPreviewResult['rows'],
): TransactionImportPreviewResult {
  return {
    rows,
    ready: rows.filter((row) => row.status === 'new').length,
    matchable: rows.filter((row) => row.status === 'match_ready').length,
    possibleDuplicates: rows.filter((row) => row.status === 'possible_duplicate').length,
    skipped: rows.filter(
      (row) => row.status === 'already_imported' || row.status === 'existing_transaction',
    ).length,
    blocked: rows.filter((row) => isBlocked(row.status)).length,
  }
}
