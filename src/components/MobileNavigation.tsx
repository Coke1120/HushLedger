import { House, List, Repeat } from 'lucide-react'

export type AppView = 'overview' | 'transactions' | 'recurring'

type MobileNavigationProps = {
  view: AppView
  onChange: (view: AppView) => void
}

export function MobileNavigation({ view, onChange }: MobileNavigationProps) {
  return (
    <nav className="mobile-navigation" aria-label="主要導覽">
      <button
        type="button"
        className={view === 'overview' ? 'is-active' : undefined}
        aria-current={view === 'overview' ? 'page' : undefined}
        onClick={() => onChange('overview')}
      >
        <House aria-hidden="true" />
        <span>總覽</span>
      </button>
      <button
        type="button"
        className={view === 'transactions' ? 'is-active' : undefined}
        aria-current={view === 'transactions' ? 'page' : undefined}
        onClick={() => onChange('transactions')}
      >
        <List aria-hidden="true" />
        <span>交易</span>
      </button>
      <button
        type="button"
        className={view === 'recurring' ? 'is-active' : undefined}
        aria-current={view === 'recurring' ? 'page' : undefined}
        onClick={() => onChange('recurring')}
      >
        <Repeat aria-hidden="true" />
        <span>週期</span>
      </button>
    </nav>
  )
}
