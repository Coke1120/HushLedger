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

function renderCategorySpending(source: Summary, privateMode = false) {
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

  it('omits comparisons when an older API response has no prior-month aggregate', () => {
    const markup = renderCategorySpending(summary)

    assert.doesNotMatch(markup, /category-spending-comparison-help/)
    assert.doesNotMatch(markup, /Recorded .* more than/)
    assert.doesNotMatch(markup, /Recorded .* less than/)
  })

  it('describes exact recorded changes without treating higher spending as good or bad', () => {
    const comparisonSummary: Summary = {
      ...summary,
      expenseByCategory: summary.expenseByCategory.map((category, index) => ({
        ...category,
        previousMonthAmountMinor: [5_000, 8_000, 5_000, 0, null, 2_000, 1_000][index],
      })),
    }
    const markup = renderCategorySpending(comparisonSummary)

    assert.match(markup, /Category differences compare recorded spending with 2026-06/)
    assert.match(markup, /Recorded HK\$20\.00 more than 2026-06/)
    assert.match(markup, /aria-label="Review Category 1:[^"]*Recorded HK\$20\.00 more than 2026-06"/)
    assert.match(markup, /Recorded HK\$20\.00 less than 2026-06/)
    assert.match(markup, /Same recorded amount as 2026-06/)
    assert.match(markup, /No recorded spending in 2026-06/)
    assert.match(markup, /Previous-month comparison unavailable/)
    assert.doesNotMatch(markup, /good|bad|over budget/i)
  })

  it('masks the comparison amount and direction in privacy mode', () => {
    const markup = renderCategorySpending({
      ...summary,
      expenseByCategory: summary.expenseByCategory.map((category) => ({
        ...category,
        previousMonthAmountMinor: category.amountMinor - 2_000,
      })),
    }, true)

    assert.match(markup, /Sensitive text hidden/)
    assert.match(markup, /aria-label="[^"]*Sensitive text hidden[^"]*"/)
    assert.doesNotMatch(markup, /HK\$20\.00/)
    assert.doesNotMatch(markup, /more than|less than|Same recorded|No recorded spending/)
  })
})
