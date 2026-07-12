import { Search } from 'lucide-react'
import { useI18n } from '../i18n'
import type { TransactionType } from '../lib/schema'

export type TransactionFilter = TransactionType | 'all'

type TransactionToolbarProps = {
  search: string
  filter: TransactionFilter
  onSearchChange: (value: string) => void
  onFilterChange: (value: TransactionFilter) => void
}

export function TransactionToolbar({ search, filter, onSearchChange, onFilterChange }: TransactionToolbarProps) {
  const { t } = useI18n()
  const filters: Array<{ value: TransactionFilter; label: string }> = [
    { value: 'all', label: t('all') },
    { value: 'expense', label: t('expense') },
    { value: 'income', label: t('income') },
  ]

  return (
    <div className="transaction-toolbar">
      <label className="search-field">
        <Search aria-hidden="true" />
        <span className="sr-only">{t('searchTransactions')}</span>
        <input
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={t('searchTransactions')}
          maxLength={80}
        />
      </label>
      <div className="filter-group" aria-label={t('transactionTypeFilter')}>
        {filters.map((item) => (
          <button
            key={item.value}
            type="button"
            className={filter === item.value ? 'is-active' : undefined}
            aria-pressed={filter === item.value}
            onClick={() => onFilterChange(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  )
}
