export const LEDGER_BACKUP_PREPARED_STORAGE_KEY = 'hushledger.ledgerBackupPreparedAt'
export const LEDGER_BACKUP_VERIFIED_STORAGE_KEY = 'hushledger.ledgerBackupVerifiedAt'
export const LEDGER_BACKUP_REMINDER_DAYS = 30

const reminderMilliseconds = LEDGER_BACKUP_REMINDER_DAYS * 24 * 60 * 60 * 1_000

export type LedgerBackupHealth = {
  lastPreparedAt: string | null
  lastVerifiedAt: string | null
}

export const emptyLedgerBackupHealth: LedgerBackupHealth = {
  lastPreparedAt: null,
  lastVerifiedAt: null,
}

export function parseLedgerBackupHealth(
  lastPreparedAt: string | null,
  lastVerifiedAt: string | null,
): LedgerBackupHealth {
  return {
    lastPreparedAt: normalizedTimestamp(lastPreparedAt),
    lastVerifiedAt: normalizedTimestamp(lastVerifiedAt),
  }
}

export function applyLedgerBackupStorageChange(
  current: LedgerBackupHealth,
  key: string,
  value: string | null,
) {
  if (key === LEDGER_BACKUP_PREPARED_STORAGE_KEY) {
    return { ...current, lastPreparedAt: normalizedTimestamp(value) }
  }
  if (key === LEDGER_BACKUP_VERIFIED_STORAGE_KEY) {
    return { ...current, lastVerifiedAt: normalizedTimestamp(value) }
  }
  return current
}

export function mergeLedgerBackupHealth(
  current: LedgerBackupHealth,
  incoming: LedgerBackupHealth,
) {
  return {
    lastPreparedAt: newestTimestamp(current.lastPreparedAt, incoming.lastPreparedAt),
    lastVerifiedAt: newestTimestamp(current.lastVerifiedAt, incoming.lastVerifiedAt),
  }
}

export function recordLedgerBackupPreparation(health: LedgerBackupHealth, at = new Date()) {
  return { ...health, lastPreparedAt: at.toISOString() }
}

export function recordLedgerBackupVerification(health: LedgerBackupHealth, at = new Date()) {
  return { ...health, lastVerifiedAt: at.toISOString() }
}

export function isLedgerBackupDue(health: LedgerBackupHealth, now = new Date()) {
  if (!health.lastPreparedAt) return true
  const elapsed = now.getTime() - Date.parse(health.lastPreparedAt)
  return !Number.isFinite(elapsed) || elapsed < 0 || elapsed >= reminderMilliseconds
}

function normalizedTimestamp(value: unknown) {
  if (typeof value !== 'string') return null
  const timestamp = new Date(value)
  if (!Number.isFinite(timestamp.getTime())) return null
  return timestamp.toISOString() === value ? value : null
}

function newestTimestamp(current: string | null, incoming: string | null) {
  if (!current) return incoming
  if (!incoming) return current
  return incoming > current ? incoming : current
}
