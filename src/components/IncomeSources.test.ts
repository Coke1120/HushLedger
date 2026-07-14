import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nContext, type I18nContextValue } from '../i18n/context'
import { translate } from '../i18n/core'
import { formatMoneyForDisplay } from '../lib/privacy'
import type { Summary } from '../lib/schema'
import { IncomeSources } from './IncomeSources'

const incomeByCategory = Array.from({ length: 7 }, (_, index) => ({
  categoryId: index + 1,
  categoryName: `Income ${index + 1}`,
  categoryLocalizationKey: null,
  categoryIcon: 'circle',
  categoryColor: '#2f7d64',
  amountMinor: (7 - index) * 1_000,
  transactionCount: index + 1,
}))

const summary: Summary = {
  month: '2026-07',
  income: 28_000,
  expense: 0,
  balance: 28_000,
  cashFlowTrend: [],
  spendingTrend: [],
  expenseByCategory: [],
  expenseByPayee: [],
  incomeByCategory,
  monthlySpendingPlans: [],
  recurringForecast: [],
}

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

function renderIncomeSources(source: Summary, privateMode = false) {
  const value: I18nContextValue = {
    ...context,
    privacyMode: privateMode,
    formatMoney: (minor, currency = 'HKD') => formatMoneyForDisplay(
      minor,
      currency,
      'en',
      privateMode,
    ),
  }
  return renderToStaticMarkup(createElement(
    I18nContext.Provider,
    { value },
    createElement(IncomeSources, {
      summary: source,
      loading: false,
      onSelect: () => undefined,
    }),
  ))
}

describe('monthly income sources', () => {
  it('shows the five largest recorded sources before deliberate expansion', () => {
    const markup = renderIncomeSources(summary)

    assert.equal(markup.match(/class="category-spending-row"/g)?.length, 5)
    assert.match(markup, /Income sources/)
    assert.match(markup, /data-income-category-id="1"/)
    assert.match(markup, /aria-controls="income-sources-list"/)
    assert.match(markup, /aria-expanded="false"/)
    assert.match(markup, /Show 2 more income sources/)
    assert.doesNotMatch(markup, /Income 6/)
    assert.doesNotMatch(markup, /Income 7/)
  })

  it('uses the singular expansion label for one remaining source', () => {
    const markup = renderIncomeSources({
      ...summary,
      income: 27_000,
      balance: 27_000,
      incomeByCategory: incomeByCategory.slice(0, 6),
    })

    assert.match(markup, /Show 1 more income source/)
  })

  it('does not invent a breakdown for an older response that lacks the aggregate', () => {
    const markup = renderIncomeSources({ ...summary, incomeByCategory: undefined })

    assert.match(markup, /Income sources are unavailable/)
    assert.doesNotMatch(markup, /No recorded income this month/)
  })

  it('distinguishes a current month with no recorded income', () => {
    const markup = renderIncomeSources({
      ...summary,
      income: 0,
      balance: 0,
      incomeByCategory: [],
    })

    assert.match(markup, /No recorded income this month/)
  })

  it('masks exact income amounts, shares, and bar lengths in privacy mode', () => {
    const markup = renderIncomeSources(summary, true)

    assert.match(markup, /Sensitive text hidden/)
    assert.match(markup, /style="width:0%;background-color:#2f7d64"/)
    assert.doesNotMatch(markup, /HK\$70\.00|25%/)
  })
})
