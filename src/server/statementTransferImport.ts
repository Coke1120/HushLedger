import 'server-only'

import type { StatementTransferImportInput } from '../lib/statementTransferImport'

type TransferIdRow = { transferId: string }
type GuardRow = {
  accountsValid: number
  matchCount: number
  readyMatchCount: number
  nearbyMatchCount: number
  transactionMatchCount: number
}

export type CreateStatementTransferImportResult =
  | { kind: 'created' | 'matched'; transferId: string }
  | { kind: 'already_imported' }
  | { kind: 'reference_invalid' }
  | { kind: 'possible_duplicate' }

const nextUpdatedAt = `
  CASE
    WHEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') > updated_at
      THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    ELSE strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+0.001 seconds')
  END
`

export async function createStatementTransferImport(
  database: D1Database,
  input: StatementTransferImportInput,
  transferId = crypto.randomUUID(),
): Promise<CreateStatementTransferImportResult> {
  const statementIsSource = input.direction === 'outflow'
  const fromAccountId = statementIsSource
    ? input.statementAccountId
    : input.counterpartyAccountId
  const toAccountId = statementIsSource
    ? input.counterpartyAccountId
    : input.statementAccountId
  const transactionType = statementIsSource ? 'expense' : 'income'
  const statementClearedColumn = statementIsSource ? 'from_cleared' : 'to_cleared'
  const candidateCtes = `
    WITH valid_accounts(currency) AS (
      SELECT statement.currency
      FROM accounts statement
      INNER JOIN accounts counterparty
        ON counterparty.id = ?
        AND counterparty.is_active = 1
        AND counterparty.currency = statement.currency
      WHERE statement.id = ?
        AND statement.is_active = 1
        AND statement.id <> counterparty.id
    ),
    matching_transfers(id, occurred_on, statement_cleared) AS (
      SELECT transfer.id, transfer.occurred_on, transfer.${statementClearedColumn}
      FROM account_transfers transfer
      INNER JOIN valid_accounts ON valid_accounts.currency = transfer.currency
      WHERE transfer.amount_minor = ?
        AND transfer.from_account_id = ?
        AND transfer.to_account_id = ?
    ),
    exact_matches(id, statement_cleared) AS (
      SELECT id, statement_cleared
      FROM matching_transfers
      WHERE occurred_on = ?
    ),
    ready_matches(id) AS (
      SELECT id FROM exact_matches WHERE statement_cleared = 0
    ),
    -- ponytail: one native transfer has one date; flag nearby counterpart
    -- postings until per-leg posting dates exist instead of auto-merging them.
    nearby_ready_matches(id) AS (
      SELECT id
      FROM matching_transfers
      WHERE occurred_on <> ?
        AND occurred_on BETWEEN date(?, '-3 days') AND date(?, '+3 days')
        AND statement_cleared = 0
    ),
    matching_transactions(id) AS (
      SELECT transaction_row.id
      FROM transactions transaction_row
      INNER JOIN valid_accounts ON valid_accounts.currency = transaction_row.currency
      WHERE transaction_row.type = ?
        AND transaction_row.amount_minor = ?
        AND transaction_row.account_id = ?
        AND transaction_row.occurred_on = ?
    )
  `
  const candidateValues = [
    input.counterpartyAccountId,
    input.statementAccountId,
    input.amountMinor,
    fromAccountId,
    toAccountId,
    input.occurredOn,
    input.occurredOn,
    input.occurredOn,
    input.occurredOn,
    transactionType,
    input.amountMinor,
    input.statementAccountId,
    input.occurredOn,
  ] as const

  const guard = database.prepare(`
    ${candidateCtes}
    SELECT
      EXISTS(SELECT 1 FROM valid_accounts) AS accountsValid,
      (SELECT COUNT(*) FROM exact_matches) AS matchCount,
      (SELECT COUNT(*) FROM ready_matches) AS readyMatchCount,
      (SELECT COUNT(*) FROM nearby_ready_matches) AS nearbyMatchCount,
      (SELECT COUNT(*) FROM matching_transactions) AS transactionMatchCount
  `).bind(...candidateValues)
  const reserve = database.prepare(`
    -- Transaction and transfer imports share one durable key namespace. The
    -- existing table intentionally has no transaction foreign key, so this
    -- tombstone survives deletion of either record kind and backup restore.
    ${candidateCtes}
    INSERT INTO transaction_import_keys(import_key, transaction_id)
    SELECT ?, ?
    FROM valid_accounts
    WHERE (SELECT COUNT(*) FROM matching_transactions) = 0
      AND (
        (
          (SELECT COUNT(*) FROM exact_matches) = 0
          AND (SELECT COUNT(*) FROM nearby_ready_matches) = 0
        )
        OR (
          (SELECT COUNT(*) FROM exact_matches) = 1
          AND (SELECT COUNT(*) FROM ready_matches) = 1
        )
      )
    ON CONFLICT(import_key) DO NOTHING
    RETURNING transaction_id AS transferId
  `).bind(
    ...candidateValues,
    input.importKey,
    transferId,
  )
  const clearMatchedLeg = database.prepare(`
    ${candidateCtes}
    UPDATE account_transfers
    SET
      ${statementClearedColumn} = 1,
      updated_at = ${nextUpdatedAt}
    WHERE id = (SELECT id FROM ready_matches LIMIT 1)
      AND (SELECT COUNT(*) FROM exact_matches) = 1
      AND (SELECT COUNT(*) FROM matching_transactions) = 0
      AND EXISTS (
        SELECT 1
        FROM transaction_import_keys
        WHERE import_key = ?
          AND transaction_id = ?
      )
      AND ${statementClearedColumn} = 0
    RETURNING id AS transferId
  `).bind(...candidateValues, input.importKey, transferId)
  const attachMatchedKey = database.prepare(`
    ${candidateCtes}
    UPDATE transaction_import_keys
    SET transaction_id = (SELECT id FROM exact_matches LIMIT 1)
    WHERE import_key = ?
      AND transaction_id = ?
      AND (SELECT COUNT(*) FROM exact_matches) = 1
      AND (SELECT COUNT(*) FROM matching_transactions) = 0
    RETURNING transaction_id AS transferId
  `).bind(...candidateValues, input.importKey, transferId)
  const insertTransfer = database.prepare(`
    ${candidateCtes}
    INSERT INTO account_transfers(
      id,
      amount_minor,
      currency,
      from_account_id,
      to_account_id,
      occurred_on,
      from_cleared,
      to_cleared,
      note
    )
    SELECT
      import_key.transaction_id,
      ?,
      statement.currency,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?
    FROM transaction_import_keys import_key
    INNER JOIN accounts statement ON statement.id = ?
    WHERE import_key.import_key = ?
      AND import_key.transaction_id = ?
      AND (SELECT COUNT(*) FROM exact_matches) = 0
      AND (SELECT COUNT(*) FROM nearby_ready_matches) = 0
      AND (SELECT COUNT(*) FROM matching_transactions) = 0
    RETURNING id AS transferId
  `).bind(
    ...candidateValues,
    input.amountMinor,
    fromAccountId,
    toAccountId,
    input.occurredOn,
    statementIsSource ? 1 : 0,
    statementIsSource ? 0 : 1,
    input.note,
    input.statementAccountId,
    input.importKey,
    transferId,
  )

  const [guardResult, reservation, cleared, attached, transfer] = await database.batch<
    GuardRow & TransferIdRow
  >([
    guard,
    reserve,
    clearMatchedLeg,
    attachMatchedKey,
    insertTransfer,
  ])
  const reserved = reservation.results[0]
  if (reserved) {
    if (
      transfer.results.length === 1
      && cleared.results.length === 0
      && attached.results.length === 0
    ) {
      return { kind: 'created', transferId }
    }
    const matched = cleared.results[0]
    const linked = attached.results[0]
    if (
      matched
      && linked?.transferId === matched.transferId
      && cleared.results.length === 1
      && attached.results.length === 1
      && transfer.results.length === 0
    ) {
      return { kind: 'matched', transferId: matched.transferId }
    }
    throw new Error('Statement transfer reservation produced an invalid mutation result')
  }

  const existing = await database.prepare(`
    SELECT transaction_id AS transferId
    FROM transaction_import_keys
    WHERE import_key = ?
  `).bind(input.importKey).first<TransferIdRow>()
  if (existing) return { kind: 'already_imported' }
  const guardRow = guardResult.results[0]
  if (!guardRow || Number(guardRow.accountsValid) !== 1) return { kind: 'reference_invalid' }
  if (
    Number(guardRow.matchCount) > 0
    || Number(guardRow.nearbyMatchCount) > 0
    || Number(guardRow.transactionMatchCount) > 0
  ) return { kind: 'possible_duplicate' }
  throw new Error('Statement transfer import failed without a diagnosable cause')
}
