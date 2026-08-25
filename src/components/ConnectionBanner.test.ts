import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nContext, type I18nContextValue } from '../i18n/context'
import { translate } from '../i18n/core'
import { formatMoneyForDisplay } from '../lib/privacy'
import { ConnectionBanner } from './ConnectionBanner'

const context: I18nContextValue = {
  locale: 'en',
  setLocale: () => undefined,
  ledgerCurrency: 'HKD',
  setLedgerCurrency: () => undefined,
  privacyMode: false,
  setPrivacyMode: () => undefined,
  t: (key, values) => translate('en', key, values),
  formatMoney: (minor, currency = 'HKD') => formatMoneyForDisplay(
    minor,
    currency,
    'en',
    false,
  ),
  formatMonth: (month) => month,
  formatDate: (date) => date,
  formatNumber: String,
  localizeEntityName: (name) => name,
}

describe('connection failure banner', () => {
  it('describes a failed ledger load as read-only without claiming data was saved', () => {
    const markup = renderToStaticMarkup(createElement(
      I18nContext.Provider,
      { value: context },
      createElement(ConnectionBanner, {
        source: 'error',
        online: true,
        actionMessage: '',
        onRetry: () => undefined,
      }),
    ))

    assert.match(markup, /private ledger could not be loaded/)
    assert.match(markup, /Editing is disabled/)
    assert.doesNotMatch(markup, /data was saved/)
  })

  it('does not label preserved live data as demo data when offline', () => {
    const markup = renderToStaticMarkup(createElement(
      I18nContext.Provider,
      { value: context },
      createElement(ConnectionBanner, {
        source: 'error',
        online: false,
        actionMessage: '',
        onRetry: () => undefined,
      }),
    ))

    assert.match(markup, /Displayed data is read-only/)
    assert.doesNotMatch(markup, /Demo data/)
  })

  it('labels the public demo as read-only without offering a failing retry', () => {
    const markup = renderToStaticMarkup(createElement(
      I18nContext.Provider,
      { value: context },
      createElement(ConnectionBanner, {
        source: 'demo',
        online: true,
        actionMessage: '',
      }),
    ))

    assert.match(markup, /read-only sample data/)
    assert.match(markup, /Editing is disabled/)
    assert.doesNotMatch(markup, /<button/)
  })
})
