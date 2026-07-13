import { Download, FileUp, Search, Sparkles, X } from 'lucide-react'
import type { RefObject } from 'react'
import { useI18n } from '../i18n'
import type { Account, Category, TransactionType } from '../lib/schema'

export type TransactionFilter = TransactionType | 'all'

type TransactionToolbarProps = {
  search: string
  tagFilter: string | null
  filter: TransactionFilter
  month: string
  accounts: Account[]
  categories: Category[]
  accountFilterId: number | null
  categoryFilterId: number | null
  canExport: boolean
  canImport: boolean
  onSearchChange: (value: string) => void
  onTagFilterChange: (value: string | null) => void
  onFilterChange: (value: TransactionFilter) => void
  onAccountFilterChange: (value: number | null) => void
  onCategoryFilterChange: (value: number | null) => void
  onClearReferenceFilters: () => void
  onCsvImport: () => void
  onAiImport: () => void
  csvImportOpen: boolean
  aiImportOpen: boolean
  csvImportButtonRef: RefObject<HTMLButtonElement | null>
  aiImportButtonRef: RefObject<HTMLButtonElement | null>
}

export function TransactionToolbar({
  search,
  tagFilter,
  filter,
  month,
  accounts,
  categories,
  accountFilterId,
  categoryFilterId,
  canExport,
  canImport,
  onSearchChange,
  onTagFilterChange,
  onFilterChange,
  onAccountFilterChange,
  onCategoryFilterChange,
  onClearReferenceFilters,
  onCsvImport,
  onAiImport,
  csvImportOpen,
  aiImportOpen,
  csvImportButtonRef,
  aiImportButtonRef,
}: TransactionToolbarProps) {
  const { localizeEntityName, t } = useI18n()
  const filters: Array<{ value: TransactionFilter; label: string }> = [
    { value: 'all', label: t('all') },
    { value: 'expense', label: t('expense') },
    { value: 'income', label: t('income') },
  ]
  const exportQuery = new URLSearchParams({ month })
  if (filter !== 'all') exportQuery.set('type', filter)
  if (accountFilterId !== null) exportQuery.set('accountId', String(accountFilterId))
  if (categoryFilterId !== null) exportQuery.set('categoryId', String(categoryFilterId))
  if (search.trim()) exportQuery.set('search', search.trim())
  if (tagFilter) exportQuery.set('tag', tagFilter.slice(1))
  const exportHref = `/api/exports/transactions?${exportQuery}`
  const visibleCategories = filter === 'all'
    ? categories
    : categories.filter((category) => category.type === filter)
  const referenceLabel = (name: string, active: boolean) => (
    active ? name : `${name} · ${t('inactive')}`
  )

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
      {tagFilter ? (
        <button
          className="transaction-tag-filter"
          type="button"
          onClick={() => onTagFilterChange(null)}
          aria-label={t('removeTagFilter', { tag: tagFilter })}
          title={t('removeTagFilter', { tag: tagFilter })}
        >
          <span>{tagFilter}</span>
          <X aria-hidden="true" />
        </button>
      ) : null}
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
      <div className="transaction-reference-filters" aria-label={t('transactionReferenceFilters')}>
        <label className="transaction-reference-filter">
          <span className="sr-only">{t('filterByAccount')}</span>
          <select
            value={accountFilterId ?? ''}
            onChange={(event) => onAccountFilterChange(event.target.value ? Number(event.target.value) : null)}
          >
            <option value="">{t('allAccounts')}</option>
            {accounts.map((account) => {
              const name = localizeEntityName(account.name, account.localizationKey)
              return (
                <option value={account.id} key={account.id}>
                  {referenceLabel(name, account.isActive)}
                </option>
              )
            })}
          </select>
        </label>
        <label className="transaction-reference-filter">
          <span className="sr-only">{t('filterByCategory')}</span>
          <select
            value={categoryFilterId ?? ''}
            onChange={(event) => onCategoryFilterChange(event.target.value ? Number(event.target.value) : null)}
          >
            <option value="">{t('allCategories')}</option>
            {visibleCategories.map((category) => {
              const name = localizeEntityName(category.name, category.localizationKey)
              const typePrefix = filter === 'all' ? `${t(category.type)} · ` : ''
              return (
                <option value={category.id} key={category.id}>
                  {typePrefix}{referenceLabel(name, category.isActive)}
                </option>
              )
            })}
          </select>
        </label>
        {accountFilterId !== null || categoryFilterId !== null ? (
          <button
            className="transaction-filter-clear"
            type="button"
            onClick={onClearReferenceFilters}
            title={t('clearReferenceFilters')}
          >
            <X aria-hidden="true" />
            <span className="sr-only">{t('clearReferenceFilters')}</span>
          </button>
        ) : null}
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
