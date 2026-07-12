import {
  ArchiveRestore,
  Download,
  FileCheck2,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { useI18n, type MessageKey } from '../i18n'
import {
  LEDGER_BACKUP_CONFIRMATION,
  MAX_LEDGER_BACKUP_FILE_BYTES,
  type LedgerRestoreCommitResult,
  type LedgerRestorePreview,
  type LedgerTableCounts,
} from '../lib/ledgerBackup'
import { ApiError, api } from '../lib/api'

type LedgerBackupSettingsProps = {
  available: boolean
  onRestored: () => Promise<boolean>
}

type BusyAction = 'download' | 'preview' | 'restore' | null

const countRows: ReadonlyArray<{ key: keyof LedgerTableCounts; label: MessageKey }> = [
  { key: 'accounts', label: 'ledgerTableAccounts' },
  { key: 'categories', label: 'ledgerTableCategories' },
  { key: 'recurringRules', label: 'ledgerTableRecurringRules' },
  { key: 'transactions', label: 'ledgerTableTransactions' },
  { key: 'transactionImportKeys', label: 'ledgerTableImportKeys' },
]

export function LedgerBackupSettings({ available, onRestored }: LedgerBackupSettingsProps) {
  const { locale, t } = useI18n()
  const fileInput = useRef<HTMLInputElement>(null)
  const [backup, setBackup] = useState<unknown>(null)
  const [fileName, setFileName] = useState('')
  const [preview, setPreview] = useState<LedgerRestorePreview | null>(null)
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState<BusyAction>(null)
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null)
  const [statusKey, setStatusKey] = useState<MessageKey | null>(null)

  const resetRestore = () => {
    setBackup(null)
    setFileName('')
    setPreview(null)
    setConfirmation('')
    if (fileInput.current) fileInput.current.value = ''
  }

  const downloadBackup = async () => {
    if (!available || busy) return
    setBusy('download')
    setErrorKey(null)
    setStatusKey(null)
    try {
      const response = await fetch('/api/backups/ledger', {
        cache: 'no-store',
        credentials: 'same-origin',
      })
      if (!response.ok) throw new Error('Backup download failed')

      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = downloadFileName(response.headers.get('content-disposition'))
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(objectUrl)
    } catch {
      setErrorKey('ledgerBackupDownloadFailed')
    } finally {
      setBusy(null)
    }
  }

  const chooseFile = async (file: File | undefined) => {
    resetRestore()
    setErrorKey(null)
    setStatusKey(null)
    if (!file) return
    setFileName(file.name)
    if (file.size > MAX_LEDGER_BACKUP_FILE_BYTES) {
      setErrorKey('ledgerBackupTooLarge')
      return
    }

    try {
      setBackup(JSON.parse(await file.text()) as unknown)
    } catch {
      setErrorKey('ledgerBackupInvalid')
    }
  }

  const previewRestore = async () => {
    if (!available || backup === null || busy) return
    setBusy('preview')
    setPreview(null)
    setConfirmation('')
    setErrorKey(null)
    setStatusKey(null)
    try {
      setPreview(await api<LedgerRestorePreview>('/api/backups/ledger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'preview', backup }),
      }))
    } catch (error) {
      setErrorKey(restoreErrorKey(error))
    } finally {
      setBusy(null)
    }
  }

  const restore = async () => {
    if (
      !available ||
      backup === null ||
      !preview ||
      confirmation !== LEDGER_BACKUP_CONFIRMATION ||
      busy
    ) return

    setBusy('restore')
    setErrorKey(null)
    setStatusKey(null)
    try {
      await api<LedgerRestoreCommitResult>('/api/backups/ledger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'commit',
          backup,
          expectedCurrentDigest: preview.currentDigest,
          expectedRevision: preview.currentRevision,
          confirmation: LEDGER_BACKUP_CONFIRMATION,
        }),
      })
      const refreshed = await onRestored()
      resetRestore()
      setStatusKey(refreshed ? 'ledgerRestoreSuccess' : 'ledgerRestoreRefreshFailed')
    } catch (error) {
      setErrorKey(restoreErrorKey(error))
      if (error instanceof ApiError && error.code === 'BACKUP_PREVIEW_STALE') {
        setPreview(null)
        setConfirmation('')
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="settings-panel ledger-backup-settings">
      <div className="settings-panel-heading ledger-backup-heading">
        <span className="settings-panel-icon" aria-hidden="true"><ArchiveRestore /></span>
        <div>
          <h3>{t('ledgerBackupTitle')}</h3>
          <p>{t('ledgerBackupHelp')}</p>
        </div>
      </div>

      {!available ? <p className="ledger-backup-unavailable">{t('ledgerBackupUnavailable')}</p> : null}

      <div className="ledger-backup-actions">
        <div className="ledger-backup-action">
          <h4>{t('downloadLedgerBackup')}</h4>
          <p>{t('ledgerBackupPlaintextWarning')}</p>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => void downloadBackup()}
            disabled={!available || busy !== null}
          >
            <Download aria-hidden="true" />
            {busy === 'download' ? t('downloadingLedgerBackup') : t('downloadLedgerBackup')}
          </button>
        </div>

        <div className="ledger-backup-action">
          <h4>{t('ledgerRestoreChooseFile')}</h4>
          <p>{t('ledgerRestoreFileHelp')}</p>
          <label className="ledger-backup-file">
            <span>{fileName || t('ledgerRestoreChooseFile')}</span>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              disabled={!available || busy !== null}
              onChange={(event) => void chooseFile(event.target.files?.[0])}
            />
          </label>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => void previewRestore()}
            disabled={!available || backup === null || busy !== null}
          >
            <FileCheck2 aria-hidden="true" />
            {busy === 'preview' ? t('ledgerRestorePreviewing') : t('ledgerRestorePreview')}
          </button>
        </div>
      </div>

      {preview ? (
        <div className="ledger-restore-report">
          <div className="ledger-restore-report-heading">
            <ShieldCheck aria-hidden="true" />
            <div>
              <h4>{t('ledgerRestoreReportTitle')}</h4>
              <p>{t('ledgerRestoreChecksumVerified')}</p>
            </div>
          </div>
          <dl className="ledger-restore-metadata">
            <div>
              <dt>{t('ledgerRestoreExportedAt')}</dt>
              <dd>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(preview.exportedAt))}</dd>
            </div>
            <div>
              <dt>SHA-256</dt>
              <dd><code>{preview.checksum}</code></dd>
            </div>
          </dl>
          <table className="ledger-restore-counts">
            <caption className="sr-only">{t('ledgerRestoreReportTitle')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('ledgerRestoreTable')}</th>
                <th scope="col">{t('ledgerRestoreCurrent')}</th>
                <th scope="col">{t('ledgerRestoreBackup')}</th>
              </tr>
            </thead>
            <tbody>
              {countRows.map((row) => (
                <tr key={row.key}>
                  <th scope="row">{t(row.label)}</th>
                  <td>{preview.currentCounts[row.key]}</td>
                  <td>{preview.backupCounts[row.key]}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="ledger-restore-danger">
            <TriangleAlert aria-hidden="true" />
            <div>
              <strong>{t('ledgerRestoreDestructiveWarning')}</strong>
              <label>
                <span>{t('ledgerRestoreConfirmationLabel')}</span>
                <input
                  value={confirmation}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setConfirmation(event.target.value)}
                  disabled={busy !== null}
                />
                <small>{t('ledgerRestoreConfirmationHelp', { confirmation: LEDGER_BACKUP_CONFIRMATION })}</small>
              </label>
              <button
                type="button"
                className="button button-danger"
                onClick={() => void restore()}
                disabled={confirmation !== LEDGER_BACKUP_CONFIRMATION || busy !== null}
              >
                <ArchiveRestore aria-hidden="true" />
                {busy === 'restore' ? t('ledgerRestoring') : t('ledgerRestoreConfirm')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <p className={`ledger-backup-status${errorKey ? ' is-error' : ''}`} aria-live="polite" aria-atomic="true">
        {errorKey ? t(errorKey) : statusKey ? t(statusKey) : ''}
      </p>
    </div>
  )
}

function downloadFileName(contentDisposition: string | null) {
  const name = contentDisposition?.match(/filename="([^"]+)"/)?.[1]
  return name ?? `hushledger-ledger-${new Date().toISOString().slice(0, 10)}.json`
}

function restoreErrorKey(error: unknown): MessageKey {
  if (!(error instanceof ApiError)) return 'ledgerRestoreFailed'
  if (error.code === 'BACKUP_CHECKSUM_MISMATCH') return 'ledgerBackupChecksumMismatch'
  if (error.code === 'BACKUP_VERSION_UNSUPPORTED' || error.code === 'BACKUP_FORMAT_UNSUPPORTED') {
    return 'ledgerBackupUnsupported'
  }
  if (error.code === 'BACKUP_RESTORE_TOO_LARGE' || error.code === 'PAYLOAD_TOO_LARGE') {
    return 'ledgerBackupTooLarge'
  }
  if (error.code === 'BACKUP_DATA_INVALID') return 'ledgerBackupDataInvalid'
  if (error.code === 'BACKUP_PREVIEW_STALE') return 'ledgerRestoreStale'
  if (error.code === 'BACKUP_INVALID' || error.code === 'INVALID_JSON') return 'ledgerBackupInvalid'
  return 'ledgerRestoreFailed'
}
