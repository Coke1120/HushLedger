import { House, List, Plus, Repeat } from 'lucide-react'
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
  return (
    <header className="app-header">
      <div className="brand" aria-label="HushLedger 私人收支管理">
        <span className="brand-mark" aria-hidden="true">
          <HushLedgerMark />
        </span>
        <span className="brand-copy">
          <strong>HushLedger</strong>
          <small>私人收支管理</small>
        </span>
      </div>
      <div className="header-actions">
        <nav className="desktop-navigation" aria-label="主要導覽">
          <button
            type="button"
            className={view === 'overview' ? 'is-active' : undefined}
            aria-current={view === 'overview' ? 'page' : undefined}
            onClick={() => onViewChange('overview')}
          >
            <House aria-hidden="true" />
            總覽
          </button>
          <button
            type="button"
            className={view === 'transactions' ? 'is-active' : undefined}
            aria-current={view === 'transactions' ? 'page' : undefined}
            onClick={() => onViewChange('transactions')}
          >
            <List aria-hidden="true" />
            交易
          </button>
          <button
            type="button"
            className={view === 'recurring' ? 'is-active' : undefined}
            aria-current={view === 'recurring' ? 'page' : undefined}
            onClick={() => onViewChange('recurring')}
          >
            <Repeat aria-hidden="true" />
            週期交易
          </button>
        </nav>
        <button className="button button-primary add-button" type="button" onClick={onAdd}>
          <Plus aria-hidden="true" />
          <span>新增交易</span>
        </button>
      </div>
    </header>
  )
}
