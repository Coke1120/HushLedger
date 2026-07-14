import { Archive, Settings2 } from 'lucide-react'
import { useI18n } from '../i18n'
import { LEDGER_BACKUP_REMINDER_DAYS } from '../lib/ledgerBackupHealth'

type LedgerBackupReminderProps = {
  due: boolean | null
  live: boolean
  disabled: boolean
  onReview: () => void
}

export function LedgerBackupReminder({
  due,
  live,
  disabled,
  onReview,
}: LedgerBackupReminderProps) {
  const { t } = useI18n()

  if (due !== true || !live) return null

  return (
    <section className="ledger-backup-reminder" aria-labelledby="ledger-backup-reminder-title">
      <span className="ledger-backup-reminder-icon" aria-hidden="true"><Archive /></span>
      <div className="ledger-backup-reminder-copy">
        <h2 id="ledger-backup-reminder-title">{t('overviewBackupReminderTitle')}</h2>
        <p>{t('overviewBackupReminderHelp', { count: LEDGER_BACKUP_REMINDER_DAYS })}</p>
      </div>
      <button
        className="button button-secondary"
        type="button"
        disabled={disabled}
        onClick={onReview}
      >
        <Settings2 aria-hidden="true" />
        {t('reviewBackupSettings')}
      </button>
    </section>
  )
}
