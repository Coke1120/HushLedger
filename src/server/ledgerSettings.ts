import 'server-only'

import {
  supportedCurrencySchema,
  type LedgerCurrencySettings,
  type SupportedCurrency,
} from '../lib/currency'

type LedgerSettingsRow = {
  currency: string
  updatedAt: string
  canChangeCurrency: number
}

export type LedgerCurrencyUpdateResult =
  | { kind: 'updated'; settings: LedgerCurrencySettings }
  | { kind: 'version_conflict' | 'locked' }

const currencyCanChange = `
  NOT EXISTS (SELECT 1 FROM transactions)
  AND NOT EXISTS (SELECT 1 FROM account_transfers)
  AND NOT EXISTS (SELECT 1 FROM recurring_rules)
  AND NOT EXISTS (SELECT 1 FROM recurring_transfer_rules)
  AND NOT EXISTS (SELECT 1 FROM transaction_import_keys)
  AND NOT EXISTS (SELECT 1 FROM accounts WHERE opening_balance_minor IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM categories WHERE monthly_plan_minor IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM emergency_fund_goals)
`

const nextUpdatedAt = `
  CASE
    WHEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') > updated_at
      THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    ELSE strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+0.001 seconds')
  END
`

export async function getLedgerCurrencySettings(
  database: D1Database,
): Promise<LedgerCurrencySettings> {
  const row = await database.prepare(`
    SELECT
      currency,
      updated_at AS updatedAt,
      CAST(${currencyCanChange} AS INTEGER) AS canChangeCurrency
    FROM ledger_settings
    WHERE id = 1
  `).first<LedgerSettingsRow>()

  if (!row) throw new Error('Ledger settings row is missing')
  return settingsFromRow(row)
}

export async function updateLedgerCurrency(
  database: D1Database,
  currency: SupportedCurrency,
  expectedUpdatedAt: string,
): Promise<LedgerCurrencyUpdateResult> {
  try {
    const updated = await database.prepare(`
      UPDATE ledger_settings
      SET
        currency = ?,
        updated_at = ${nextUpdatedAt}
      WHERE id = 1
        AND updated_at = ?
        AND currency <> ?
        AND ${currencyCanChange}
      RETURNING currency, updated_at AS updatedAt
    `).bind(currency, expectedUpdatedAt, currency).first<{
      currency: string
      updatedAt: string
    }>()

    if (updated) {
      return {
        kind: 'updated',
        settings: {
          currency: supportedCurrencySchema.parse(updated.currency),
          updatedAt: updated.updatedAt,
          canChangeCurrency: true,
        },
      }
    }
  } catch (error) {
    const diagnosed = await diagnoseFailedUpdate(database, currency, expectedUpdatedAt)
    if (diagnosed) return diagnosed
    throw error
  }

  const diagnosed = await diagnoseFailedUpdate(database, currency, expectedUpdatedAt)
  if (diagnosed) return diagnosed
  throw new Error('Ledger currency update failed without a diagnosable cause')
}

async function diagnoseFailedUpdate(
  database: D1Database,
  currency: SupportedCurrency,
  expectedUpdatedAt: string,
): Promise<LedgerCurrencyUpdateResult | null> {
  const current = await getLedgerCurrencySettings(database)
  if (current.updatedAt !== expectedUpdatedAt) return { kind: 'version_conflict' }
  if (current.currency === currency) return { kind: 'updated', settings: current }
  if (!current.canChangeCurrency) return { kind: 'locked' }
  return null
}

function settingsFromRow(row: LedgerSettingsRow): LedgerCurrencySettings {
  return {
    currency: supportedCurrencySchema.parse(row.currency),
    updatedAt: row.updatedAt,
    canChangeCurrency: row.canChangeCurrency === 1,
  }
}
