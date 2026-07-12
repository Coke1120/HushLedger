import { Eye, EyeOff, House, List, Plus, Repeat, Settings } from 'lucide-react'
import { useI18n } from '../i18n'
import type { AppView } from './MobileNavigation'

type AppHeaderProps = {
  view: AppView
  onAdd: () => void
  onViewChange: (view: AppView) => void
}

function HushLedgerMark() {
  return (
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 15c7-2 13-1 18 3v28c-5-4-11-5-18-3zM50 15c-7-2-13-1-18 3v28c5-4 11-5 18-3z" />
      <path d="M38 25h7M38 31h7M9 50c9-5 15-5 23 0s14 5 23 0" />
    </svg>
  )
}

export function AppHeader({ view, onAdd, onViewChange }: AppHeaderProps) {
  const { privacyMode, setPrivacyMode, t } = useI18n()
  const privacyLabel = t(privacyMode ? 'showAmounts' : 'hideAmounts')

  return (
    <header className="app-header">
      <div className="brand" aria-label={t('appTitle')}>
        <span className="brand-mark" aria-hidden="true">
          <HushLedgerMark />
        </span>
        <span className="brand-copy">
          <strong>HushLedger</strong>
          <small>{t('appTagline')}</small>
        </span>
      </div>
      <div className="header-actions">
        <nav className="desktop-navigation" aria-label={t('mainNavigation')}>
          <button
            type="button"
            className={view === 'overview' ? 'is-active' : undefined}
            aria-current={view === 'overview' ? 'page' : undefined}
            onClick={() => onViewChange('overview')}
          >
            <House aria-hidden="true" />
            <span className="nav-label">{t('overview')}</span>
          </button>
          <button
            type="button"
            className={view === 'transactions' ? 'is-active' : undefined}
            aria-current={view === 'transactions' ? 'page' : undefined}
            onClick={() => onViewChange('transactions')}
          >
            <List aria-hidden="true" />
            <span className="nav-label">{t('transactions')}</span>
          </button>
          <button
            type="button"
            className={view === 'recurring' ? 'is-active' : undefined}
            aria-current={view === 'recurring' ? 'page' : undefined}
            onClick={() => onViewChange('recurring')}
          >
            <Repeat aria-hidden="true" />
            <span className="nav-label">{t('recurring')}</span>
          </button>
          <button
            type="button"
            className={view === 'settings' ? 'is-active' : undefined}
            aria-current={view === 'settings' ? 'page' : undefined}
            onClick={() => onViewChange('settings')}
          >
            <Settings aria-hidden="true" />
            <span className="nav-label">{t('settings')}</span>
          </button>
        </nav>
        <button
          className={`icon-button privacy-toggle${privacyMode ? ' is-active' : ''}`}
          type="button"
          aria-label={privacyLabel}
          aria-pressed={privacyMode}
          title={privacyLabel}
          onClick={() => setPrivacyMode(!privacyMode)}
        >
          {privacyMode ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </button>
        <button className="button button-primary add-button" type="button" onClick={onAdd}>
          <Plus aria-hidden="true" />
          <span>{t('addTransaction')}</span>
        </button>
      </div>
    </header>
  )
}
