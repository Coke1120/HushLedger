import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nContext, type I18nContextValue } from '../i18n/context'
import { translate } from '../i18n/core'
import { formatMoneyForDisplay } from '../lib/privacy'
import { MobileNavigation } from './MobileNavigation'

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

function renderMobileNavigation(disabled = false, addDisabled = false) {
  return renderToStaticMarkup(createElement(
    I18nContext.Provider,
    { value: context },
    createElement(MobileNavigation, {
      view: 'transactions',
      disabled,
      addDisabled,
      onChange: () => undefined,
      onAdd: () => undefined,
    }),
  ))
}

describe('mobile navigation', () => {
  it('keeps quick add between the transaction and recurring destinations', () => {
    const markup = renderMobileNavigation()

    assert.equal(markup.match(/<button/g)?.length, 5)
    assert.match(markup, /aria-current="page"/)
    assert.match(markup, /class="mobile-navigation-add" aria-label="Add transaction"/)
    assert.ok(markup.indexOf('mobile-navigation-add') > markup.indexOf('Transactions'))
    assert.ok(markup.indexOf('mobile-navigation-add') < markup.indexOf('Recurring'))
  })

  it('locks quick add with the rest of the ledger navigation', () => {
    const markup = renderMobileNavigation(true)

    assert.equal(markup.match(/ disabled=""/g)?.length, 5)
    assert.match(markup, /class="mobile-navigation-add" aria-label="Add transaction" disabled=""/)
  })

  it('can hold quick add until the initial ledger finishes loading', () => {
    const markup = renderMobileNavigation(false, true)

    assert.equal(markup.match(/ disabled=""/g)?.length, 1)
    assert.match(markup, /class="mobile-navigation-add" aria-label="Add transaction" disabled=""/)
  })
})
