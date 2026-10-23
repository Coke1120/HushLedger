import 'server-only'
import type { PastePreview, PasteReceipt, PasteRow } from '../lib/pasteApproval'
import { readLedgerRevision } from './money'

export class PasteConflict extends Error {}

export async function previewPaste(database: D1Database, rows: PasteRow[]): Promise<PastePreview> {
  // A revision around the reads prevents a preview from silently mixing ledger versions.
  const revision = await readLedgerRevision(database)
  const results = await database.batch(rows.map((row) => database.prepare(`
    SELECT
      EXISTS(SELECT 1 FROM transactions WHERE account_id = ? AND currency = ?
        AND type = ? AND occurred_on = ? AND amount_minor = ?
        AND lower(trim(payee)) = lower(trim(?))) AS duplicate,
      (EXISTS(SELECT 1 FROM transaction_import_keys WHERE import_key = ?)
        OR EXISTS(SELECT 1 FROM transactions WHERE id = ?)
        OR EXISTS(SELECT 1 FROM transaction_import_keys WHERE transaction_id = ?)) AS imported,
      (EXISTS(SELECT 1 FROM accounts WHERE id = ? AND currency = ? AND is_active = 1)
        AND EXISTS(SELECT 1 FROM categories WHERE id = ? AND type = ? AND is_active = 1)) AS valid
  `).bind(row.accountId, row.currency, row.type, row.occurredOn, row.amountMinor,
    row.payee, row.importKey, row.id, row.id, row.accountId, row.currency, row.categoryId, row.type)))
  if (revision !== await readLedgerRevision(database)) throw new PasteConflict()
  const identity = (row: PasteRow) => JSON.stringify([
    row.accountId, row.currency, row.type, row.occurredOn, row.amountMinor,
    row.payee.trim().normalize('NFC').toLowerCase(),
  ])
  return { revision, rows: results.map((result, index) => {
    const flags = result.results[0] as { duplicate: number; imported: number; valid: number }
    return {
      id: rows[index].id,
      duplicate: Boolean(flags.duplicate) || rows.some((row, other) =>
        other !== index && identity(row) === identity(rows[index])),
      imported: Boolean(flags.imported), valid: Boolean(flags.valid),
    }
  }) }
}

async function receipt(database: D1Database, id: string): Promise<PasteReceipt | null> {
  return database.prepare(`SELECT id AS operationId, state,
    (SELECT COUNT(*) FROM paste_operation_items WHERE operation_id = id) AS count
    FROM paste_operations WHERE id = ?`).bind(id).first<PasteReceipt>()
}

export async function approvePaste(
  database: D1Database, operationId: string, expectedRevision: number, rows: PasteRow[],
): Promise<PasteReceipt> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(rows)))
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  const previous = await database.prepare('SELECT payload_hash FROM paste_operations WHERE id = ?')
    .bind(operationId).first<{ payload_hash: string }>()
  if (previous) {
    if (previous.payload_hash !== hash) throw new PasteConflict()
    return (await receipt(database, operationId))!
  }
  const preview = await previewPaste(database, rows)
  if (preview.revision !== expectedRevision || preview.rows.some((row, index) =>
    !row.valid || row.imported || (row.duplicate && !rows[index].duplicateConfirmed))) {
    throw new PasteConflict()
  }
  const statements = [database.prepare(`INSERT INTO paste_operations(id, payload_hash)
    VALUES (?, CASE WHEN (SELECT revision FROM ledger_state WHERE id = 1) = ? THEN ? ELSE NULL END)`)
    .bind(operationId, expectedRevision, hash)]
  for (const row of rows) {
    statements.push(
      database.prepare(`INSERT INTO transactions
        (id, type, amount_minor, currency, account_id, category_id, occurred_on, cleared, payee, note, import_review_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reviewed')`)
        .bind(row.id, row.type, row.amountMinor, row.currency, row.accountId, row.categoryId,
          row.occurredOn, row.cleared ? 1 : 0, row.payee, row.note),
      database.prepare('INSERT INTO transaction_import_keys(import_key, transaction_id) VALUES (?, ?)')
        .bind(row.importKey, row.id),
      database.prepare(`INSERT INTO transaction_approvals(transaction_id, approved_version)
        SELECT id, updated_at FROM transactions WHERE id = ?`).bind(row.id),
      database.prepare(`INSERT INTO paste_operation_items(operation_id, transaction_id, approved_version)
        SELECT ?, id, updated_at FROM transactions WHERE id = ?`).bind(operationId, row.id),
    )
  }
  try {
    await database.batch(statements)
  } catch (error) {
    // A simultaneous retry may have committed first. Re-enter once to resolve its receipt.
    const existing = await database.prepare('SELECT payload_hash FROM paste_operations WHERE id = ?')
      .bind(operationId).first<{ payload_hash: string }>()
    if (existing?.payload_hash === hash) return (await receipt(database, operationId))!
    if (/constraint/i.test(String(error))) throw new PasteConflict()
    throw error
  }
  return (await receipt(database, operationId))!
}

export async function undoPaste(database: D1Database, operationId: string): Promise<PasteReceipt> {
  const previous = await receipt(database, operationId)
  if (!previous) throw new PasteConflict()
  if (previous.state !== 'approved') return previous
  try {
    await database.batch([
      // NOT NULL enforces all-or-nothing. A changed or deleted row blocks the whole undo.
      database.prepare(`UPDATE paste_operations SET state = CASE WHEN
        (SELECT COUNT(*) FROM paste_operation_items WHERE operation_id = ?) =
        (SELECT COUNT(*) FROM paste_operation_items i JOIN transactions t
          ON t.id = i.transaction_id AND t.updated_at = i.approved_version
          JOIN transaction_approvals a ON a.transaction_id = t.id AND a.approved_version = t.updated_at
          WHERE i.operation_id = ?) THEN 'undone' ELSE NULL END,
        undone_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ? AND state = 'approved'`).bind(operationId, operationId, operationId),
      database.prepare(`DELETE FROM transactions WHERE id IN (
        SELECT transaction_id FROM paste_operation_items WHERE operation_id = ?)
        AND EXISTS(SELECT 1 FROM paste_operations WHERE id = ? AND state = 'undone')`)
        .bind(operationId, operationId),
    ])
  } catch (error) {
    if (/constraint/i.test(String(error))) throw new PasteConflict()
    throw error
  }
  return (await receipt(database, operationId))!
}
