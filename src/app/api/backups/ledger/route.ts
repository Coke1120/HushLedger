import {
  LEDGER_BACKUP_FORMAT,
  LEDGER_BACKUP_VERSION,
  LEGACY_LEDGER_SCHEMA_VERSION,
  LEDGER_SCHEMA_VERSION,
  PRE_CURRENCY_LEDGER_SCHEMA_VERSION,
  PRE_RECURRING_TRANSFERS_LEDGER_SCHEMA_VERSION,
  PRE_SCHEDULE_END_LEDGER_SCHEMA_VERSION,
  PRE_YEARLY_RECURRING_LEDGER_SCHEMA_VERSION,
  PRE_MONTHLY_PLAN_LEDGER_SCHEMA_VERSION,
  PRE_OPENING_BALANCE_LEDGER_SCHEMA_VERSION,
  PRE_TRANSFERS_LEDGER_SCHEMA_VERSION,
  PREVIOUS_LEDGER_SCHEMA_VERSION,
  MAX_LEDGER_BACKUP_REQUEST_BYTES,
  ledgerBackupExportRequestSchema,
  ledgerRestoreRequestSchema,
} from '../../../../lib/ledgerBackup'
import { getDatabase } from '../../../../server/db'
import {
  apiNotFound,
  apiRoute,
  guardMutationRequest,
  jsonError,
  jsonSuccess,
  readApiJson,
  sanitizeValidationIssues,
} from '../../../../server/http'
import {
  exportLedgerBackup,
  previewLedgerRestore,
  restoreLedgerBackup,
  verifyLedgerBackup,
} from '../../../../server/ledgerBackup'

export const dynamic = 'force-dynamic'

export const GET = apiNotFound

export const POST = apiRoute(async (request) => {
  const guarded = guardMutationRequest(request, MAX_LEDGER_BACKUP_REQUEST_BYTES)
  if (guarded) return guarded

  const body = await readApiJson(request, MAX_LEDGER_BACKUP_REQUEST_BYTES)
  if (!body.ok) return body.response

  const exportRequest = ledgerBackupExportRequestSchema.safeParse(body.data)
  if (exportRequest.success) {
    const backup = await exportLedgerBackup(await getDatabase())
    return new Response(`${JSON.stringify(backup, null, 2)}\n`, {
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Disposition': `attachment; filename="hushledger-ledger-${backup.exportedAt.slice(0, 10)}.json"`,
        'Content-Type': 'application/json; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  }

  const compatibilityError = backupCompatibilityError(body.data)
  if (compatibilityError) return compatibilityError

  const parsed = ledgerRestoreRequestSchema.safeParse(body.data)
  if (!parsed.success) {
    return jsonError(
      400,
      'BACKUP_INVALID',
      '備份檔案格式不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }

  const verified = await verifyLedgerBackup(parsed.data.backup)
  if (!verified.ok) {
    const status = verified.code === 'BACKUP_RESTORE_TOO_LARGE' ? 413 : 400
    return jsonError(status, verified.code, backupVerificationMessage(verified.code), verified.issues)
  }

  const database = await getDatabase()
  if (parsed.data.mode === 'preview') {
    return jsonSuccess(await previewLedgerRestore(database, verified.value))
  }

  const restored = await restoreLedgerBackup(
    database,
    verified.value,
    parsed.data.expectedCurrentDigest,
    parsed.data.expectedRevision,
  )
  if (!restored.ok) {
    return jsonError(409, restored.code, '帳本在預覽後已變更，請重新預覽備份')
  }
  return jsonSuccess(restored.value)
})

export const HEAD = apiNotFound
export const PUT = apiNotFound
export const PATCH = apiNotFound
export const DELETE = apiNotFound
export const OPTIONS = apiNotFound

function backupCompatibilityError(value: unknown) {
  if (!value || typeof value !== 'object') return null
  const backup = (value as Record<string, unknown>).backup
  if (!backup || typeof backup !== 'object') return null
  const candidate = backup as Record<string, unknown>

  if (candidate.format !== LEDGER_BACKUP_FORMAT) {
    return jsonError(400, 'BACKUP_FORMAT_UNSUPPORTED', '這不是 HushLedger 帳本備份')
  }
  if (
    candidate.version !== LEDGER_BACKUP_VERSION ||
    (
      candidate.schemaVersion !== LEDGER_SCHEMA_VERSION &&
      candidate.schemaVersion !== PRE_RECURRING_TRANSFERS_LEDGER_SCHEMA_VERSION &&
      candidate.schemaVersion !== PRE_SCHEDULE_END_LEDGER_SCHEMA_VERSION &&
      candidate.schemaVersion !== PRE_YEARLY_RECURRING_LEDGER_SCHEMA_VERSION &&
      candidate.schemaVersion !== PRE_CURRENCY_LEDGER_SCHEMA_VERSION &&
      candidate.schemaVersion !== PREVIOUS_LEDGER_SCHEMA_VERSION &&
      candidate.schemaVersion !== PRE_OPENING_BALANCE_LEDGER_SCHEMA_VERSION &&
      candidate.schemaVersion !== PRE_TRANSFERS_LEDGER_SCHEMA_VERSION &&
      candidate.schemaVersion !== PRE_MONTHLY_PLAN_LEDGER_SCHEMA_VERSION &&
      candidate.schemaVersion !== LEGACY_LEDGER_SCHEMA_VERSION
    )
  ) {
    return jsonError(400, 'BACKUP_VERSION_UNSUPPORTED', '這個備份版本與目前的 HushLedger 不相容')
  }
  return null
}

function backupVerificationMessage(code: string) {
  if (code === 'BACKUP_CHECKSUM_MISMATCH') return '備份完整性檢查失敗'
  if (code === 'BACKUP_RESTORE_TOO_LARGE') return '備份太大，無法在應用程式內安全還原'
  return '備份內容無法形成有效帳本'
}
