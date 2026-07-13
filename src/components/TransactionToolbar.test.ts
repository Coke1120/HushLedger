import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement, createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nContext, type I18nContextValue } from '../i18n/context'
import { translate } from '../i18n/core'
import { formatMoneyForDisplay } from '../lib/privacy'
import { TransactionToolbar } from './TransactionToolbar'

function renderToolbar(tagFilter: string | null) {
  const context: I18nContextValue = {
    locale: 'en',
    setLocale: () => undefined,
    ledgerCurrency: 'HKD',
    setLedgerCurrency: () => undefined,
    privacyMode: false,
    setPrivacyMode: () => undefined,
    t: (key, values) => translate('en', key, values),
    formatMoney: (minor, currency = 'HKD') => formatMoneyForDisplay(minor, currency, 'en', false),
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
      payeeFilter: null,
      tagFilter,
      filter: 'all',
      clearingFilter: 'all',
      dateScope: 'month',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
      duplicatesOnly: false,
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
      onPayeeFilterChange: noop,
      onTagFilterChange: noop,
      onFilterChange: noop,
      onClearingFilterChange: noop,
      onDateScopeChange: noop,
      onDateFromChange: noop,
      onDateToChange: noop,
      onDuplicatesOnlyChange: noop,
      onSortChange: noop,
      onAccountFilterChange: noop,
      onCategoryFilterChange: noop,
      onClearReferenceFilters: noop,
      onCsvImport: noop,
      onAiImport: noop,
      csvImportOpen: false,
      aiImportOpen: false,
      csvImportButtonRef: createRef<HTMLButtonElement>(),
      aiImportButtonRef: createRef<HTMLButtonElement>(),
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
