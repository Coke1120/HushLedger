import 'server-only'

import type { SupportedCurrency } from '../lib/currency'
import { monthRangeDates } from '../lib/date'
import type {
  AccountLocalizationKey,
  AccountTransfer,
  AccountTransferInput,
  AccountTransferUpdateInput,
} from '../lib/schema'

type AccountTransferRow = {
  id: string
  amountMinor: number
  currency: SupportedCurrency
  fromAccountId: number
  toAccountId: number
  occurredOn: string
  fromCleared: number
  toCleared: number
  note: string
  fromAccountName: string
  fromAccountLocalizationKey: AccountLocalizationKey | null
  toAccountName: string
  toAccountLocalizationKey: AccountLocalizationKey | null
  createdAt: string
  updatedAt: string
}

type AccountReferenceRow = {
  id: number
  currency: string
  isActive: number
}

export type CreateAccountTransferResult =
  | { kind: 'created' | 'existing'; transfer: AccountTransfer }
  | { kind: 'id_conflict' }
  | { kind: 'reference_invalid' }

export type UpdateAccountTransferResult =
  | { kind: 'updated'; transfer: AccountTransfer }
  | { kind: 'not_found' }
  | { kind: 'version_conflict' }
  | { kind: 'reference_invalid' }

export type DeleteAccountTransferResult =
  | { kind: 'deleted'; id: string }
  | { kind: 'not_found' }
  | { kind: 'version_conflict' }

const accountTransferSelect = `
  SELECT
    transfer.id,
    transfer.amount_minor AS amountMinor,
    transfer.currency,
    transfer.from_account_id AS fromAccountId,
    transfer.to_account_id AS toAccountId,
    transfer.occurred_on AS occurredOn,
    transfer.from_cleared AS fromCleared,
    transfer.to_cleared AS toCleared,
    transfer.note,
    source.name AS fromAccountName,
    source.localization_key AS fromAccountLocalizationKey,
    destination.name AS toAccountName,
    destination.localization_key AS toAccountLocalizationKey,
    transfer.created_at AS createdAt,
    transfer.updated_at AS updatedAt
  FROM account_transfers transfer
  INNER JOIN accounts source ON source.id = transfer.from_account_id
  INNER JOIN accounts destination ON destination.id = transfer.to_account_id
`

export async function listAccountTransfers(
  database: D1Database,
  query: { month: string; accountId?: number },
): Promise<AccountTransfer[]> {
  const { start, end } = monthRangeDates(query.month)
  const accountId = query.accountId ?? null
  const result = await database.prepare(`
    ${accountTransferSelect}
    WHERE transfer.occurred_on >= ? AND transfer.occurred_on < ?
      AND (? IS NULL OR transfer.from_account_id = ? OR transfer.to_account_id = ?)
    ORDER BY transfer.occurred_on DESC, transfer.created_at DESC, transfer.id DESC
    LIMIT 200
  `)
    .bind(start, end, accountId, accountId, accountId)
    .all<AccountTransferRow>()

  return result.results.map(accountTransferView)
}

export async function getAccountTransfer(database: D1Database, id: string) {
  const row = await database.prepare(`${accountTransferSelect} WHERE transfer.id = ? LIMIT 1`)
    .bind(id)
    .first<AccountTransferRow>()
  return row ? accountTransferView(row) : null
}

export async function createAccountTransfer(
  database: D1Database,
  input: AccountTransferInput,
): Promise<CreateAccountTransferResult> {
  const existing = await getAccountTransfer(database, input.id)
  if (existing) {
    return matchesTransferInput(existing, input)
      ? { kind: 'existing', transfer: existing }
      : { kind: 'id_conflict' }
  }

  if (!await accountReferencesAreValid(database, input)) return { kind: 'reference_invalid' }

  const inserted = await database.prepare(`
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
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE ? <> ?
      AND EXISTS (
        SELECT 1 FROM accounts
        WHERE id = ? AND is_active = 1 AND currency = ?
      )
      AND EXISTS (
        SELECT 1 FROM accounts
        WHERE id = ? AND is_active = 1 AND currency = ?
      )
    ON CONFLICT(id) DO NOTHING
  `)
    .bind(
      input.id,
      input.amountMinor,
      input.currency,
      input.fromAccountId,
      input.toAccountId,
      input.occurredOn,
      input.fromCleared ? 1 : 0,
      input.toCleared ? 1 : 0,
      input.note,
      input.fromAccountId,
      input.toAccountId,
      input.fromAccountId,
      input.currency,
      input.toAccountId,
      input.currency,
    )
    .run()

  const transfer = await getAccountTransfer(database, input.id)
  if (!transfer) {
    if (!await accountReferencesAreValid(database, input)) return { kind: 'reference_invalid' }
    throw new Error('Account transfer insert did not produce a row')
  }
  if (!matchesTransferInput(transfer, input)) return { kind: 'id_conflict' }

  return {
    kind: Number(inserted.meta.changes) > 0 ? 'created' : 'existing',
    transfer,
  }
}

export async function updateAccountTransfer(
  database: D1Database,
  id: string,
  input: AccountTransferUpdateInput,
): Promise<UpdateAccountTransferResult> {
  const existing = await getAccountTransfer(database, id)
  if (!existing) return { kind: 'not_found' }
  if (existing.updatedAt !== input.updatedAt) return { kind: 'version_conflict' }

  const existingAccountIds = new Set([existing.fromAccountId, existing.toAccountId])
  if (!await accountReferencesAreValid(database, input, existingAccountIds)) {
    return { kind: 'reference_invalid' }
  }

  const updated = await database.prepare(`
    UPDATE account_transfers
    SET
      amount_minor = ?,
      currency = ?,
      from_account_id = ?,
      to_account_id = ?,
      occurred_on = ?,
      from_cleared = ?,
      to_cleared = ?,
      note = ?,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ? AND updated_at = ? AND ? <> ?
      AND EXISTS (
        SELECT 1 FROM accounts
        WHERE id = ? AND currency = ? AND (is_active = 1 OR id IN (?, ?))
      )
      AND EXISTS (
        SELECT 1 FROM accounts
        WHERE id = ? AND currency = ? AND (is_active = 1 OR id IN (?, ?))
      )
  `)
    .bind(
      input.amountMinor,
      input.currency,
      input.fromAccountId,
      input.toAccountId,
      input.occurredOn,
      input.fromCleared ? 1 : 0,
      input.toCleared ? 1 : 0,
      input.note,
      id,
      input.updatedAt,
      input.fromAccountId,
      input.toAccountId,
      input.fromAccountId,
      input.currency,
      existing.fromAccountId,
      existing.toAccountId,
      input.toAccountId,
      input.currency,
      existing.fromAccountId,
      existing.toAccountId,
    )
    .run()

  if (Number(updated.meta.changes) === 0) {
    const current = await getAccountTransfer(database, id)
    return current ? { kind: 'version_conflict' } : { kind: 'not_found' }
  }

  const transfer = await getAccountTransfer(database, id)
  if (!transfer) throw new Error('Account transfer update did not produce a row')
  return { kind: 'updated', transfer }
}

export async function deleteAccountTransfer(
  database: D1Database,
  id: string,
  updatedAt: string,
): Promise<DeleteAccountTransferResult> {
  const deleted = await database.prepare(
    'DELETE FROM account_transfers WHERE id = ? AND updated_at = ?',
  )
    .bind(id, updatedAt)
    .run()

  if (Number(deleted.meta.changes) === 0) {
    const existing = await getAccountTransfer(database, id)
    return existing ? { kind: 'version_conflict' } : { kind: 'not_found' }
  }
  return { kind: 'deleted', id }
}

async function accountReferencesAreValid(
  database: D1Database,
  input: Pick<AccountTransferInput, 'currency' | 'fromAccountId' | 'toAccountId'>,
  allowedInactiveIds = new Set<number>(),
) {
  if (input.fromAccountId === input.toAccountId) return false
  const result = await database.prepare(`
    SELECT id, currency, is_active AS isActive
    FROM accounts
    WHERE id IN (?, ?)
  `)
    .bind(input.fromAccountId, input.toAccountId)
    .all<AccountReferenceRow>()
  const accounts = new Map(result.results.map((account) => [account.id, account]))

  return [input.fromAccountId, input.toAccountId].every((id) => {
    const account = accounts.get(id)
    return Boolean(
      account
      && account.currency === input.currency
      && (account.isActive === 1 || allowedInactiveIds.has(id)),
    )
  })
}

function accountTransferView(row: AccountTransferRow): AccountTransfer {
  return {
    ...row,
    fromCleared: row.fromCleared === 1,
    toCleared: row.toCleared === 1,
  }
}

function matchesTransferInput(transfer: AccountTransfer, input: AccountTransferInput) {
  return (
    transfer.id === input.id
    && transfer.amountMinor === input.amountMinor
    && transfer.currency === input.currency
    && transfer.fromAccountId === input.fromAccountId
    && transfer.toAccountId === input.toAccountId
    && transfer.occurredOn === input.occurredOn
    && transfer.fromCleared === input.fromCleared
    && transfer.toCleared === input.toCleared
    && transfer.note === input.note
  )
}
