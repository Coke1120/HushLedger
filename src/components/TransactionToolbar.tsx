import { Download, FileUp, Search, Sparkles } from 'lucide-react'
import type { RefObject } from 'react'
import { useI18n } from '../i18n'
import type { TransactionType } from '../lib/schema'

export type TransactionFilter = TransactionType | 'all'

type TransactionToolbarProps = {
  search: string
  filter: TransactionFilter
  month: string
  canExport: boolean
  canImport: boolean
  onSearchChange: (value: string) => void
  onFilterChange: (value: TransactionFilter) => void
  onCsvImport: () => void
  onAiImport: () => void
  csvImportOpen: boolean
  aiImportOpen: boolean
  csvImportButtonRef: RefObject<HTMLButtonElement | null>
  aiImportButtonRef: RefObject<HTMLButtonElement | null>
}

export function TransactionToolbar({
  search,
  filter,
  month,
  canExport,
  canImport,
  onSearchChange,
  onFilterChange,
  onCsvImport,
  onAiImport,
  csvImportOpen,
  aiImportOpen,
  csvImportButtonRef,
  aiImportButtonRef,
}: TransactionToolbarProps) {
  const { t } = useI18n()
  const filters: Array<{ value: TransactionFilter; label: string }> = [
    { value: 'all', label: t('all') },
    { value: 'expense', label: t('expense') },
    { value: 'income', label: t('income') },
  ]
  const exportQuery = new URLSearchParams({ month })
  if (filter !== 'all') exportQuery.set('type', filter)
  if (search.trim()) exportQuery.set('search', search.trim())
  const exportHref = `/api/exports/transactions?${exportQuery}`

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
      {canExport ? (
        <a
          className="button button-secondary export-button"
          href={exportHref}
          download
          title={t('exportCsvHelp')}
        >
          <Download aria-hidden="true" />
          {t('exportCsv')}
        </a>
      ) : (
        <button
          className="button button-secondary export-button"
          type="button"
          disabled
          title={t('exportCsvUnavailable')}
        >
          <Download aria-hidden="true" />
          {t('exportCsv')}
        </button>
      )}
      <button
        id="csv-import-trigger"
        className="button button-secondary csv-import-button"
        type="button"
        onClick={onCsvImport}
        aria-expanded={csvImportOpen}
        aria-controls="csv-import-panel"
        ref={csvImportButtonRef}
        disabled={!canImport}
        title={!canImport ? t('csvImportUnavailable') : undefined}
      >
        <FileUp aria-hidden="true" />
        {t('csvImport')}
      </button>
      <button
        id="ai-import-trigger"
        className="button button-secondary ai-import-button"
        type="button"
        onClick={onAiImport}
        aria-expanded={aiImportOpen}
        aria-controls="bank-import-panel"
        ref={aiImportButtonRef}
      >
        <Sparkles aria-hidden="true" />
        {t('aiImport')}
      </button>
    </div>
  )
}
