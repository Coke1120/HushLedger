import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nContext, type I18nContextValue } from '../i18n/context'
import { translate } from '../i18n/core'
import { MonthNavigator } from './MonthNavigator'

const context: I18nContextValue = {
  locale: 'en',
  setLocale: () => undefined,
  ledgerCurrency: 'HKD',
  setLedgerCurrency: () => undefined,
  privacyMode: false,
  setPrivacyMode: () => undefined,
  t: (key, values) => translate('en', key, values),
  formatMoney: String,
  formatMonth: (month) => month,
  formatDate: (date) => date,
  formatNumber: String,
  localizeEntityName: (name) => name,
}

function renderMonthNavigator(disabled: boolean) {
  return renderToStaticMarkup(createElement(
    I18nContext.Provider,
    { value: context },
    createElement(MonthNavigator, {
      month: '2026-06',
      currentMonth: '2026-07',
      disabled,
      onChange: () => undefined,
      onPrevious: () => undefined,
      onNext: () => undefined,
    }),
  ))
}

describe('report month navigation', () => {
  it('keeps every month control available outside a ledger mutation', () => {
    assert.doesNotMatch(renderMonthNavigator(false), / disabled=""/)
  })

  it('disables every month control during a ledger mutation', () => {
    assert.equal(renderMonthNavigator(true).match(/ disabled=""/g)?.length, 4)
  })
})
