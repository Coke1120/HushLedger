import { House, List, Repeat, Settings } from 'lucide-react'
import { useI18n } from '../i18n'

export type AppView = 'overview' | 'transactions' | 'recurring' | 'settings'

type MobileNavigationProps = {
  view: AppView
  disabled: boolean
  onChange: (view: AppView) => void
}

export function MobileNavigation({ view, disabled, onChange }: MobileNavigationProps) {
  const { t } = useI18n()

  return (
    <nav className="mobile-navigation" aria-label={t('mainNavigation')}>
      <button
        type="button"
        className={view === 'overview' ? 'is-active' : undefined}
        aria-current={view === 'overview' ? 'page' : undefined}
        disabled={disabled}
        onClick={() => onChange('overview')}
      >
        <House aria-hidden="true" />
        <span>{t('overview')}</span>
      </button>
      <button
        type="button"
        className={view === 'transactions' ? 'is-active' : undefined}
        aria-current={view === 'transactions' ? 'page' : undefined}
        disabled={disabled}
        onClick={() => onChange('transactions')}
      >
        <List aria-hidden="true" />
        <span>{t('transactions')}</span>
      </button>
      <button
        type="button"
        className={view === 'recurring' ? 'is-active' : undefined}
        aria-current={view === 'recurring' ? 'page' : undefined}
        disabled={disabled}
        onClick={() => onChange('recurring')}
      >
        <Repeat aria-hidden="true" />
        <span>{t('recurringShort')}</span>
      </button>
      <button
        type="button"
        className={view === 'settings' ? 'is-active' : undefined}
        aria-current={view === 'settings' ? 'page' : undefined}
        disabled={disabled}
        onClick={() => onChange('settings')}
      >
        <Settings aria-hidden="true" />
        <span>{t('settings')}</span>
      </button>
    </nav>
  )
}
