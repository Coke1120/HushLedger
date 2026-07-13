import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nContext, type I18nContextValue } from '../i18n/context'
import { translate } from '../i18n/core'
import { formatMoneyForDisplay } from '../lib/privacy'
import type { Summary } from '../lib/schema'
import { CategorySpending } from './CategorySpending'

const categories = Array.from({ length: 7 }, (_, index) => ({
  categoryId: index + 1,
  categoryName: `Category ${index + 1}`,
  categoryLocalizationKey: null,
  categoryIcon: 'circle',
  categoryColor: '#47645c',
  amountMinor: (7 - index) * 1_000,
  transactionCount: index + 1,
}))

const summary: Summary = {
  month: '2026-07',
  income: 0,
  expense: 28_000,
  balance: -28_000,
  cashFlowTrend: [],
  spendingTrend: [],
  expenseByCategory: categories,
  expenseByPayee: categories.map((category) => ({
    payee: `Payee ${category.categoryId}`,
    amountMinor: category.amountMinor,
    transactionCount: category.transactionCount,
  })),
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

function renderCategorySpending(source: Summary) {
  return renderToStaticMarkup(createElement(
    I18nContext.Provider,
    { value: context },
    createElement(CategorySpending, {
      summary: source,
      loading: false,
      onSelectCategory: () => undefined,
      onSelectPayee: () => undefined,
    }),
  ))
}

describe('complete spending breakdown review', () => {
  it('keeps long breakdowns concise until the user deliberately expands them', () => {
    const markup = renderCategorySpending(summary)

    assert.equal(markup.match(/class="category-spending-row"/g)?.length, 5)
    assert.match(markup, /id="category-spending-category-list"/)
    assert.match(markup, /aria-controls="category-spending-category-list"/)
    assert.match(markup, /aria-expanded="false"/)
    assert.match(markup, /Show 2 more spending categories/)
    assert.doesNotMatch(markup, /Category 6/)
    assert.doesNotMatch(markup, /Category 7/)
  })

  it('does not add an expansion action when the complete breakdown already fits', () => {
    const markup = renderCategorySpending({
      ...summary,
      expenseByCategory: summary.expenseByCategory.slice(0, 5),
    })

    assert.equal(markup.match(/class="category-spending-row"/g)?.length, 5)
    assert.doesNotMatch(markup, /category-spending-actions/)
    assert.doesNotMatch(markup, /aria-expanded=/)
  })
})
