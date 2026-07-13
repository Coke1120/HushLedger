import 'server-only'

import type {
  EmergencyFundGoal,
  EmergencyFundGoalDeleteInput,
  EmergencyFundGoalSaveInput,
} from '../lib/schema'

export type EmergencyFundGoalSaveResult =
  | { kind: 'created' | 'updated'; goal: EmergencyFundGoal }
  | { kind: 'not_found' | 'version_conflict' | 'account_invalid' | 'currency_conflict' }

export type EmergencyFundGoalDeleteResult =
  | { kind: 'deleted' }
  | { kind: 'not_found' | 'version_conflict' }

const goalSelect = `
  SELECT
    account_id AS accountId,
    target_minor AS targetMinor,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM emergency_fund_goals
  WHERE id = 1
`

const nextUpdatedAt = `
  CASE
    WHEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') > updated_at
      THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    ELSE strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+0.001 seconds')
  END
`

export async function getEmergencyFundGoal(database: D1Database) {
  return database.prepare(goalSelect).first<EmergencyFundGoal>()
}

export async function saveEmergencyFundGoal(
  database: D1Database,
  input: EmergencyFundGoalSaveInput,
): Promise<EmergencyFundGoalSaveResult> {
  if (input.expectedUpdatedAt === null) {
    const inserted = await database.prepare(`
      INSERT INTO emergency_fund_goals(
        id, account_id, target_minor, created_at, updated_at
      )
      SELECT
        1,
        ?,
        ?,
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM accounts
      WHERE id = ?
        AND is_active = 1
        AND currency = ?
        AND EXISTS (
          SELECT 1 FROM ledger_settings WHERE id = 1 AND currency = ?
        )
        AND type IN ('cash', 'bank', 'wallet')
      ON CONFLICT(id) DO NOTHING
      RETURNING
        account_id AS accountId,
        target_minor AS targetMinor,
        created_at AS createdAt,
        updated_at AS updatedAt
    `).bind(
      input.accountId,
      input.targetMinor,
      input.accountId,
      input.expectedCurrency,
      input.expectedCurrency,
    ).run()

    const goal = inserted.results[0] as EmergencyFundGoal | undefined
    if (!goal) {
      if (!await ledgerCurrencyMatches(database, input.expectedCurrency)) {
        return { kind: 'currency_conflict' }
      }
      if (await getEmergencyFundGoal(database)) return { kind: 'version_conflict' }
      return await isEligibleAccount(database, input.accountId)
        ? { kind: 'version_conflict' }
        : { kind: 'account_invalid' }
    }
    if (inserted.results.length !== 1) {
      throw new Error('Emergency fund goal insert returned an unexpected row count')
    }
    return { kind: 'created', goal }
  }

  const updated = await database.prepare(`
    UPDATE emergency_fund_goals
    SET
      account_id = ?,
      target_minor = ?,
      updated_at = ${nextUpdatedAt}
    WHERE id = 1
      AND updated_at = ?
      AND EXISTS (
        SELECT 1
        FROM accounts
        WHERE id = ?
          AND is_active = 1
          AND currency = ?
          AND EXISTS (
            SELECT 1 FROM ledger_settings WHERE id = 1 AND currency = ?
          )
          AND type IN ('cash', 'bank', 'wallet')
      )
    RETURNING
      account_id AS accountId,
      target_minor AS targetMinor,
      created_at AS createdAt,
      updated_at AS updatedAt
  `).bind(
    input.accountId,
    input.targetMinor,
    input.expectedUpdatedAt,
    input.accountId,
    input.expectedCurrency,
    input.expectedCurrency,
  ).run()

  const goal = updated.results[0] as EmergencyFundGoal | undefined
  if (!goal) {
    const current = await getEmergencyFundGoal(database)
    if (!current) return { kind: 'not_found' }
    if (current.updatedAt !== input.expectedUpdatedAt) return { kind: 'version_conflict' }
    if (!await ledgerCurrencyMatches(database, input.expectedCurrency)) {
      return { kind: 'currency_conflict' }
    }
    return await isEligibleAccount(database, input.accountId)
      ? { kind: 'version_conflict' }
      : { kind: 'account_invalid' }
  }
  if (updated.results.length !== 1) {
    throw new Error('Emergency fund goal update returned an unexpected row count')
  }
  return { kind: 'updated', goal }
}

export async function deleteEmergencyFundGoal(
  database: D1Database,
  input: EmergencyFundGoalDeleteInput,
): Promise<EmergencyFundGoalDeleteResult> {
  const deleted = await database.prepare(`
    DELETE FROM emergency_fund_goals
    WHERE id = 1 AND updated_at = ?
  `).bind(input.expectedUpdatedAt).run()
  if (Number(deleted.meta.changes) > 0) return { kind: 'deleted' }

  return await getEmergencyFundGoal(database)
    ? { kind: 'version_conflict' }
    : { kind: 'not_found' }
}

async function isEligibleAccount(database: D1Database, accountId: number) {
  const account = await database.prepare(`
    SELECT 1 AS found
    FROM accounts
    WHERE id = ?
      AND is_active = 1
      AND currency = (SELECT currency FROM ledger_settings WHERE id = 1)
      AND type IN ('cash', 'bank', 'wallet')
    LIMIT 1
  `).bind(accountId).first<{ found: number }>()
  return account?.found === 1
}

async function ledgerCurrencyMatches(
  database: D1Database,
  expectedCurrency: EmergencyFundGoalSaveInput['expectedCurrency'],
) {
  const row = await database.prepare(`
    SELECT 1 AS found
    FROM ledger_settings
    WHERE id = 1 AND currency = ?
    LIMIT 1
  `).bind(expectedCurrency).first<{ found: number }>()
  return row?.found === 1
}
