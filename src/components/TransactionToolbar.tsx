import { AlertTriangle, Download, FileUp, Flag, Search, Sparkles, X } from 'lucide-react'
import { useState, type RefObject } from 'react'
import { useI18n } from '../i18n'
import { trailingSevenDayRange, trailingTwelveMonthRange } from '../lib/date'
import type {
  Account,
  Category,
  TransactionClearingStatus,
  TransactionDateScope,
  TransactionSort,
  TransactionType,
} from '../lib/schema'
import { transactionQueryFromFilters } from '../lib/transactionQuery'

export type TransactionFilter = TransactionType | 'all'
export type TransactionClearingFilter = TransactionClearingStatus | 'all'
type ExportState = 'idle' | 'preparing' | 'ready' | 'error'
type TransactionDateScopeOption = TransactionDateScope | 'trailing7' | 'trailing12'

const followUpTag = '#follow-up'

type TransactionToolbarProps = {
  search: string
  payeeFilter: string | null
  tagFilter: string | null
  filter: TransactionFilter
  clearingFilter: TransactionClearingFilter
  dateScope: TransactionDateScope
  dateFrom: string
  dateTo: string
  duplicatesOnly: boolean
  sort: TransactionSort
  showSort: boolean
  month: string
  currentDate: string
  accounts: Account[]
  categories: Category[]
  accountFilterId: number | null
  categoryFilterId: number | null
  canExport: boolean
  canImport: boolean
  onSearchChange: (value: string) => void
  onPayeeFilterChange: (value: string | null) => void
  onTagFilterChange: (value: string | null) => void
  onFilterChange: (value: TransactionFilter) => void
  onClearingFilterChange: (value: TransactionClearingFilter) => void
  onDateScopeChange: (value: TransactionDateScope) => void
  onDateFromChange: (value: string) => void
  onDateToChange: (value: string) => void
  onDuplicatesOnlyChange: (value: boolean) => void
  onSortChange: (value: TransactionSort) => void
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
  payeeFilter,
  tagFilter,
  filter,
  clearingFilter,
  dateScope,
  dateFrom,
  dateTo,
  duplicatesOnly,
  sort,
  showSort,
  month,
  currentDate,
  accounts,
  categories,
  accountFilterId,
  categoryFilterId,
  canExport,
  canImport,
  onSearchChange,
  onPayeeFilterChange,
  onTagFilterChange,
  onFilterChange,
  onClearingFilterChange,
  onDateScopeChange,
  onDateFromChange,
  onDateToChange,
  onDuplicatesOnlyChange,
  onSortChange,
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
  const [exportState, setExportState] = useState<ExportState>('idle')
  const trailingSevenDays = trailingSevenDayRange(currentDate)
  const trailingTwelveMonths = trailingTwelveMonthRange(month)
  const dateScopeOption: TransactionDateScopeOption = (
    dateScope === 'range'
    && dateFrom === trailingSevenDays.start
    && dateTo === trailingSevenDays.end
  )
    ? 'trailing7'
    : dateScope === 'range'
      && dateFrom === trailingTwelveMonths.start
      && dateTo === trailingTwelveMonths.end
      ? 'trailing12'
      : dateScope
  const filters: Array<{ value: TransactionFilter; label: string }> = [
    { value: 'all', label: t('all') },
    { value: 'expense', label: t('expense') },
    { value: 'income', label: t('income') },
  ]
  const exportQuery = transactionQueryFromFilters({
    month,
    scope: showSort ? dateScope : 'month',
    dateFrom,
    dateTo,
    type: filter,
    status: clearingFilter,
    accountId: accountFilterId,
    categoryId: categoryFilterId,
    payee: payeeFilter,
    search,
    tag: tagFilter,
    duplicatesOnly,
    sort: showSort ? sort : 'date_desc',
  })
  const exporting = exportState === 'preparing'
  const exportStatus = exportState === 'preparing'
    ? t('exportCsvPreparing')
    : exportState === 'ready'
      ? t('exportCsvReady')
      : exportState === 'error'
        ? t('exportCsvFailed')
        : ''
  const exportTransactions = async () => {
    if (!canExport || exporting) return
    setExportState('preparing')
    try {
      const response = await fetch('/api/exports/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(exportQuery),
        cache: 'no-store',
        credentials: 'same-origin',
      })
      const contentType = response.headers.get('content-type') ?? ''
      if (!response.ok || !/^text\/csv(?:;|$)/i.test(contentType)) {
        throw new Error('Transaction export failed')
      }

      const objectUrl = URL.createObjectURL(await response.blob())
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = transactionExportFileName(response.headers.get('content-disposition'))
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
      setExportState('ready')
    } catch {
      setExportState('error')
    }
  }
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
          autoComplete="off"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="none"
        />
      </label>
      {payeeFilter || tagFilter ? (
        <div className="transaction-active-filters">
          {payeeFilter ? (
            <button
              className="transaction-tag-filter transaction-payee-filter"
              type="button"
              onClick={() => onPayeeFilterChange(null)}
              aria-label={t('removePayeeFilter', { payee: payeeFilter })}
              title={t('removePayeeFilter', { payee: payeeFilter })}
            >
              <span>{payeeFilter}</span>
              <X aria-hidden="true" />
            </button>
          ) : null}
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
        </div>
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
      <button
        className={`button button-secondary transaction-duplicate-filter${duplicatesOnly ? ' is-active' : ''}`}
        type="button"
        aria-pressed={duplicatesOnly}
        onClick={() => onDuplicatesOnlyChange(!duplicatesOnly)}
        title={t('reviewPossibleDuplicatesHelp')}
      >
        <AlertTriangle aria-hidden="true" />
        {t('reviewPossibleDuplicates')}
      </button>
      <div className="transaction-reference-filters" aria-label={t('transactionReferenceFilters')}>
        <button
          className={`button button-secondary transaction-follow-up-filter${tagFilter === followUpTag ? ' is-active' : ''}`}
          type="button"
          aria-pressed={tagFilter === followUpTag}
          onClick={() => onTagFilterChange(tagFilter === followUpTag ? null : followUpTag)}
          title={t('reviewFollowUpHelp')}
        >
          <Flag aria-hidden="true" />
          {t('reviewFollowUp')}
        </button>
        {showSort ? (
          <label className="transaction-reference-filter transaction-date-scope">
            <span className="sr-only">{t('transactionDateScope')}</span>
            <select
              value={dateScopeOption}
              onChange={(event) => {
                const nextScope = event.target.value as TransactionDateScopeOption
                if (nextScope === 'trailing7') {
                  onDateFromChange(trailingSevenDays.start)
                  onDateToChange(trailingSevenDays.end)
                  onDateScopeChange('range')
                  return
                }
                if (nextScope === 'trailing12') {
                  onDateFromChange(trailingTwelveMonths.start)
                  onDateToChange(trailingTwelveMonths.end)
                  onDateScopeChange('range')
                  return
                }
                onDateScopeChange(nextScope)
              }}
              title={t('transactionDateScopeHelp')}
            >
              <option value="month">{t('selectedMonth')}</option>
              <option value="trailing7">{t('trailingSevenDays')}</option>
              <option value="trailing12">{t('trailingTwelveMonths')}</option>
              <option value="range">{t('customRange')}</option>
              <option value="all">{t('allHistory')}</option>
            </select>
          </label>
        ) : null}
        {showSort && dateScope === 'range' ? (
          <div className="transaction-custom-range" role="group" aria-label={t('customRange')}>
            <label>
              <span>{t('dateFrom')}</span>
              <input
                type="date"
                value={dateFrom}
                max={dateTo}
                onChange={(event) => {
                  if (event.target.value) onDateFromChange(event.target.value)
                }}
              />
            </label>
            <label>
              <span>{t('dateTo')}</span>
              <input
                type="date"
                value={dateTo}
                min={dateFrom}
                onChange={(event) => {
                  if (event.target.value) onDateToChange(event.target.value)
                }}
              />
            </label>
          </div>
        ) : null}
        {showSort ? (
          <label className="transaction-reference-filter transaction-sort-filter">
            <span className="sr-only">{t('sortTransactions')}</span>
            <select
              value={sort}
              onChange={(event) => onSortChange(event.target.value as TransactionSort)}
            >
              <option value="date_desc">{t('sortDateNewest')}</option>
              <option value="date_asc">{t('sortDateOldest')}</option>
              <option value="amount_desc">{t('sortAmountLargest')}</option>
              <option value="amount_asc">{t('sortAmountSmallest')}</option>
              <option value="payee_asc">{t('sortPayeeAscending')}</option>
              <option value="payee_desc">{t('sortPayeeDescending')}</option>
            </select>
          </label>
        ) : null}
        <label className="transaction-reference-filter">
          <span className="sr-only">{t('filterByClearingStatus')}</span>
          <select
            value={clearingFilter}
            onChange={(event) => onClearingFilterChange(event.target.value as TransactionClearingFilter)}
          >
            <option value="all">{t('allClearingStatuses')}</option>
            <option value="uncleared">{t('uncleared')}</option>
            <option value="cleared">{t('cleared')}</option>
          </select>
        </label>
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
        <button
          className="button button-secondary export-button"
          type="button"
          onClick={() => void exportTransactions()}
          disabled={exporting}
          aria-describedby="transaction-export-status"
          title={t('exportCsvHelp')}
        >
          <Download aria-hidden="true" />
          {exporting ? t('exportCsvPreparing') : t('exportCsv')}
        </button>
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
      <p
        id="transaction-export-status"
        className={`transaction-export-status${exportState === 'error' ? ' is-error' : ''}`}
        aria-live="polite"
        aria-atomic="true"
      >
        {exportStatus}
      </p>
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

function transactionExportFileName(contentDisposition: string | null) {
  return contentDisposition?.match(/filename="([^"]+)"/)?.[1] ?? 'hushledger-transactions.csv'
}
