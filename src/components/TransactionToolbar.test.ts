import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement, createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nContext, type I18nContextValue } from '../i18n/context'
import { translate } from '../i18n/core'
import { formatMoneyForDisplay } from '../lib/privacy'
import { transactionActionsDisclosureActive } from '../lib/transactionDisclosure'
import { TransactionToolbar } from './TransactionToolbar'

function renderToolbar(
  tagFilter: string | null,
  options: {
    amountFilterMinor?: number | null
    aiCopilotOpen?: boolean
    duplicatesOnly?: boolean
    importReviewFilter?: 'all' | 'unreviewed' | 'needs_follow_up' | 'reviewed'
    payeeFilter?: string | null
    privacyMode?: boolean
  } = {},
) {
  const {
    amountFilterMinor = null,
    aiCopilotOpen = false,
    duplicatesOnly = false,
    importReviewFilter = 'all',
    payeeFilter = null,
    privacyMode = false,
  } = options
  const context: I18nContextValue = {
    locale: 'en',
    setLocale: () => undefined,
    ledgerCurrency: 'HKD',
    setLedgerCurrency: () => undefined,
    privacyMode,
    setPrivacyMode: () => undefined,
    t: (key, values) => translate('en', key, values),
    formatMoney: (minor, currency = 'HKD') => formatMoneyForDisplay(minor, currency, 'en', privacyMode),
    formatMonth: (month) => month,
    formatDate: (date) => date,
    formatNumber: String,
    localizeEntityName: (name) => name,
  }
  const noop = () => undefined

  return renderToStaticMarkup(createElement(
    I18nContext.Provider,
    { value: context },
    createElement(TransactionToolbar, {
      search: '',
      amountFilterMinor,
      payeeFilter,
      tagFilter,
      filter: 'all',
      clearingFilter: 'all',
      importReviewFilter,
      dateScope: 'month',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
      duplicatesOnly,
      sort: 'date_desc',
      showSort: true,
      month: '2026-07',
      currentDate: '2026-07-14',
      accounts: [],
      categories: [],
      accountFilterId: null,
      categoryFilterId: null,
      canExport: false,
      canImport: false,
      onSearchChange: noop,
      onAmountFilterChange: noop,
      onPayeeFilterChange: noop,
      onTagFilterChange: noop,
      onFilterChange: noop,
      onClearingFilterChange: noop,
      onImportReviewFilterChange: noop,
      onDateScopeChange: noop,
      onDateFromChange: noop,
      onDateToChange: noop,
      onDuplicatesOnlyChange: noop,
      onSortChange: noop,
      onAccountFilterChange: noop,
      onCategoryFilterChange: noop,
      onClearReferenceFilters: noop,
      onCsvImport: noop,
      onAiCopilot: noop,
      csvImportOpen: false,
      aiCopilotOpen,
      csvImportButtonRef: createRef<HTMLButtonElement>(),
      aiCopilotButtonRef: createRef<HTMLButtonElement>(),
    }),
  ))
}

describe('follow-up transaction review', () => {
  it('exposes the exact #follow-up tag as a neutral accessible toggle', () => {
    const inactiveMarkup = renderToolbar(null)
    const activeMarkup = renderToolbar('#follow-up')

    assert.match(inactiveMarkup, /transaction-follow-up-filter[^>]*aria-pressed="false"/)
    assert.match(inactiveMarkup, />Needs follow-up<\/button>/)
    assert.match(inactiveMarkup, /personal review marker, not a fraud determination/)
    assert.doesNotMatch(inactiveMarkup, /transaction-tag-filter/)

    assert.match(activeMarkup, /transaction-follow-up-filter is-active[^>]*aria-pressed="true"/)
    assert.match(activeMarkup, /transaction-tag-filter[^>]*aria-label="Remove the #follow-up filter"/)
    assert.match(activeMarkup, /<span>#follow-up<\/span>/)
  })
})

describe('calm transaction toolbar disclosures', () => {
  it('keeps search, type, and date scope prominent while grouping secondary controls', () => {
    const markup = renderToolbar(null)
    const searchIndex = markup.indexOf('class="search-field"')
    const typeIndex = markup.indexOf('class="filter-group"')
    const dateIndex = markup.indexOf('class="transaction-reference-filter transaction-date-scope"')
    const reviewIndex = markup.indexOf('class="transaction-toolbar-disclosure transaction-review-disclosure"')
    const moreIndex = markup.indexOf('class="transaction-toolbar-disclosure transaction-more-filters-disclosure"')
    const sortIndex = markup.indexOf('class="transaction-reference-filter transaction-sort-filter"')
    const actionsIndex = markup.indexOf('class="transaction-toolbar-disclosure transaction-actions-disclosure"')
    const exportIndex = markup.indexOf('class="button button-secondary export-button"')

    assert.ok(searchIndex >= 0 && searchIndex < reviewIndex)
    assert.ok(typeIndex >= 0 && typeIndex < reviewIndex)
    assert.ok(dateIndex >= 0 && dateIndex < reviewIndex)
    assert.ok(moreIndex < sortIndex)
    assert.ok(actionsIndex < exportIndex)
    assert.match(markup, /<summary aria-controls="transaction-review-filters-panel" aria-expanded="false">/)
    assert.match(markup, /<summary aria-controls="transaction-more-filters-panel" aria-expanded="false">/)
    assert.match(markup, /<summary aria-controls="transaction-actions-panel" aria-expanded="false">/)
  })

  it('opens each disclosure when a contained filter or panel is active', () => {
    const reviewMarkup = renderToolbar(null, { duplicatesOnly: true })
    const moreMarkup = renderToolbar(null, { amountFilterMinor: 12_345 })
    const actionsMarkup = renderToolbar(null, { aiCopilotOpen: true })

    assert.match(reviewMarkup, /transaction-review-disclosure is-active" open=""/)
    assert.match(reviewMarkup, /transaction-duplicate-filter is-active[^>]*aria-pressed="true"/)
    assert.match(moreMarkup, /transaction-more-filters-disclosure is-active" open=""/)
    assert.match(moreMarkup, /class="transaction-amount-filter"/)
    assert.match(actionsMarkup, /transaction-actions-disclosure is-active" open=""/)
    assert.match(actionsMarkup, /id="ai-copilot-trigger"[^>]*aria-expanded="true"[^>]*aria-controls="ai-copilot-panel"/)
  })

  it('releases the Actions disclosure after export reaches a terminal state', () => {
    assert.equal(transactionActionsDisclosureActive(false, false, 'preparing'), true)
    assert.equal(transactionActionsDisclosureActive(false, false, 'ready'), false)
    assert.equal(transactionActionsDisclosureActive(false, false, 'error'), false)
    assert.equal(transactionActionsDisclosureActive(true, false, 'ready'), true)
  })

  it('keeps active payee and tag chips visible outside the disclosures', () => {
    const markup = renderToolbar('#follow-up', { payeeFilter: 'Harbour Market' })
    const activeFiltersIndex = markup.indexOf('class="transaction-active-filters"')
    const reviewIndex = markup.indexOf('class="transaction-toolbar-disclosure transaction-review-disclosure')

    assert.ok(activeFiltersIndex >= 0 && activeFiltersIndex < reviewIndex)
    assert.match(markup, /transaction-payee-filter[^>]*aria-label="Remove the exact payee filter for Harbour Market"/)
    assert.match(markup, /transaction-tag-filter[^>]*aria-label="Remove the #follow-up filter"/)
    assert.match(markup, /transaction-review-disclosure is-active" open=""/)
  })
})

describe('exact amount transaction filter', () => {
  it('renders an explicit amount form and masks its draft in privacy mode', () => {
    const visibleMarkup = renderToolbar(null, { amountFilterMinor: 12_345 })
    const privateMarkup = renderToolbar(null, { amountFilterMinor: 12_345, privacyMode: true })

    assert.match(visibleMarkup, /class="transaction-amount-filter"/)
    assert.match(visibleMarkup, /type="text"[^>]*value="123\.45"/)
    assert.match(visibleMarkup, />Apply amount</)
    assert.match(privateMarkup, /type="password"[^>]*value="123\.45"/)
  })
})

describe('import checklist filter', () => {
  it('offers the exact imported-row states separately from the #follow-up tag', () => {
    const markup = renderToolbar('#follow-up', { importReviewFilter: 'needs_follow_up' })

    assert.match(markup, /class="transaction-reference-filter transaction-import-review-filter"/)
    assert.match(markup, /<select[^>]*title="Filter the local import checklist only\. This does not detect or determine fraud, authorization, or bank confirmation, and is separate from #follow-up tags\."[^>]*>/)
    assert.match(markup, /<option value="all">All import checklist states<\/option>/)
    assert.match(markup, /<option value="unreviewed">Import checklist: unreviewed<\/option>/)
    assert.match(markup, /<option value="needs_follow_up" selected="">Import checklist: needs follow-up<\/option>/)
    assert.match(markup, /<option value="reviewed">Import checklist: reviewed<\/option>/)
    assert.match(markup, /transaction-follow-up-filter is-active/)
  })
})
