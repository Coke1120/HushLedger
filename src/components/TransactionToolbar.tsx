import { Search } from 'lucide-react'
import type { TransactionType } from '../lib/schema'

export type TransactionFilter = TransactionType | 'all'

type TransactionToolbarProps = {
  search: string
  filter: TransactionFilter
  onSearchChange: (value: string) => void
  onFilterChange: (value: TransactionFilter) => void
}

const filters: Array<{ value: TransactionFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'expense', label: '支出' },
  { value: 'income', label: '收入' },
]

export function TransactionToolbar({ search, filter, onSearchChange, onFilterChange }: TransactionToolbarProps) {
  return (
    <div className="transaction-toolbar">
      <label className="search-field">
        <Search aria-hidden="true" />
        <span className="sr-only">搜尋商戶或備註</span>
        <input
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="搜尋商戶或備註"
          maxLength={80}
        />
      </label>
      <div className="filter-group" aria-label="交易類型篩選">
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
