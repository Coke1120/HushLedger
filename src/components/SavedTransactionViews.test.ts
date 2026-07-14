import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nContext, type I18nContextValue } from '../i18n/context'
import { translate } from '../i18n/core'
import { formatMoneyForDisplay } from '../lib/privacy'
import type { SavedTransactionView } from '../lib/savedTransactionViews'
import { SavedTransactionViews } from './SavedTransactionViews'

const view: SavedTransactionView = {
  id: '248e3e55-d864-4a32-bf48-46bd3608060f',
  name: 'Exact charge',
  scope: 'month',
  dateFrom: null,
  dateTo: null,
  type: 'all',
  status: 'all',
  importReviewStatus: 'unreviewed',
  accountId: null,
  categoryId: null,
  payee: null,
  search: '',
  amountMinor: 12_345,
  tag: null,
  duplicates: false,
  sort: 'date_desc',
}

function renderViews(privacyMode: boolean) {
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
    createElement(SavedTransactionViews, {
      views: [view],
      accounts: [],
      categories: [],
      canSave: true,
      onSave: noop,
      onApply: noop,
      onDelete: noop,
      onReset: noop,
    }),
  ))
}

describe('saved transaction view amount privacy', () => {
  it('shows the formatted exact amount only while screen privacy is off', () => {
    assert.match(renderViews(false), /Exact amount HK\$123\.45/)
    assert.match(renderViews(false), /Import checklist: unreviewed/)
    assert.doesNotMatch(renderViews(true), /123\.45/)
    assert.match(renderViews(true), /Exact amount Sensitive text hidden/)
  })
})
