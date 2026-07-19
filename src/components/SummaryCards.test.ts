import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nContext, type I18nContextValue } from '../i18n/context'
import { translate } from '../i18n/core'
import { formatMoneyForDisplay } from '../lib/privacy'
import type { Summary } from '../lib/schema'
import { SummaryCards } from './SummaryCards'

const summary: Summary = {
  month: '2026-07',
  income: 123_456,
  expense: 83_456,
  balance: 40_000,
  cashFlowTrend: [],
  spendingTrend: [],
  expenseByCategory: [],
  expenseByPayee: [],
  monthlySpendingPlans: [],
  recurringForecast: [],
}

function renderSummaryCards(
  privacyMode: boolean,
  loading = false,
  disabled = false,
  summaryValue = summary,
) {
  const context: I18nContextValue = {
    locale: 'en',
    setLocale: () => undefined,
    ledgerCurrency: 'HKD',
    setLedgerCurrency: () => undefined,
    privacyMode,
    setPrivacyMode: () => undefined,
    t: (key, values) => translate('en', key, values),
    formatMoney: (minor, currency = 'HKD') => formatMoneyForDisplay(
      minor,
      currency,
      'en',
      privacyMode,
    ),
    formatMonth: (month) => month,
    formatDate: (date) => date,
    formatNumber: String,
    localizeEntityName: (name) => name,
  }

  return renderToStaticMarkup(createElement(
    I18nContext.Provider,
    { value: context },
    createElement(SummaryCards, {
      summary: summaryValue,
      loading,
      disabled,
      onSelect: () => undefined,
    }),
  ))
}

describe('monthly summary transaction review', () => {
  it('makes balance, income, and expense exact native actions', () => {
    const markup = renderSummaryCards(false)

    assert.equal(markup.match(/<button/g)?.length, 3)
    assert.match(markup, /HK\$400\.00/)
    assert.match(markup, /HK\$1,234\.56/)
    assert.match(markup, /HK\$834\.56/)
    assert.match(markup, /Recorded savings rate/)
    assert.match(markup, /32%/)
    assert.match(markup, /aria-describedby="monthly-savings-rate"/)
    assert.match(markup, /aria-label="Review recorded transactions behind this monthly balance: HK\$400\.00\."/)
    assert.match(markup, /aria-label="Review recorded monthly income transactions: HK\$1,234\.56\."/)
    assert.match(markup, /aria-label="Review recorded monthly expense transactions: HK\$834\.56\."/)
  })

  it('shows placeholders and disables review while loading', () => {
    const markup = renderSummaryCards(false, true)

    assert.equal(markup.match(/—/g)?.length, 4)
    assert.equal(markup.match(/ disabled=""/g)?.length, 3)
    assert.match(markup, /aria-busy="true"/)
  })

  it('does not invent a savings rate without recorded income', () => {
    const markup = renderSummaryCards(false, false, false, {
      ...summary,
      income: 0,
      expense: 0,
      balance: 0,
    })

    assert.match(markup, /Recorded savings rate/)
    assert.equal(markup.match(/—/g)?.length, 1)
    assert.doesNotMatch(markup, /aria-describedby="monthly-savings-rate"/)
  })

  it('disables every review action while ledger interaction is unavailable', () => {
    assert.equal(renderSummaryCards(false, false, true).match(/ disabled=""/g)?.length, 3)
  })

  it('keeps action labels useful without leaking amounts in privacy mode', () => {
    const markup = renderSummaryCards(true)

    assert.doesNotMatch(markup, /1,234\.56|834\.56|400\.00/)
    assert.equal(markup.match(/HK\$••••/g)?.length, 6)
    assert.match(markup, /Sensitive text hidden/)
    assert.doesNotMatch(markup, /aria-describedby="monthly-savings-rate"/)
  })
})
