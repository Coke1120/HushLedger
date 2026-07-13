import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nContext, type I18nContextValue } from '../i18n/context'
import { translate } from '../i18n/core'
import { formatMoneyForDisplay } from '../lib/privacy'
import type { Summary } from '../lib/schema'
import { MonthlySpendingPlans } from './MonthlySpendingPlans'

const plans = Array.from({ length: 7 }, (_, index) => ({
  categoryId: index + 1,
  categoryName: `Plan ${index + 1}`,
  categoryLocalizationKey: null,
  categoryIcon: 'circle',
  categoryColor: '#47645c',
  plannedMinor: (index + 1) * 10_000,
  spentMinor: (index + 1) * 5_000,
}))

const summary: Summary = {
  month: '2026-07',
  income: 0,
  expense: 140_000,
  balance: -140_000,
  cashFlowTrend: [],
  spendingTrend: [],
  expenseByCategory: [],
  expenseByPayee: [],
  monthlySpendingPlans: plans,
  recurringForecast: [],
}

function renderPlans(source: Summary, privacyMode = false) {
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
    createElement(MonthlySpendingPlans, {
      summary: source,
      loading: false,
      onSelect: () => undefined,
    }),
  ))
}

describe('complete monthly spending plan review', () => {
  it('keeps the overview concise without making later plans unreachable or exposing private amounts', () => {
    const markup = renderPlans(summary)
    const fittingMarkup = renderPlans({
      ...summary,
      monthlySpendingPlans: summary.monthlySpendingPlans.slice(0, 5),
    })
    const singularMarkup = renderPlans({
      ...summary,
      monthlySpendingPlans: summary.monthlySpendingPlans.slice(0, 6),
    })
    const privateMarkup = renderPlans(summary, true)

    assert.equal(markup.match(/class="category-spending-row monthly-plan-row"/g)?.length, 5)
    assert.match(markup, /id="monthly-spending-plan-list"/)
    assert.match(markup, /aria-controls="monthly-spending-plan-list"/)
    assert.match(markup, /aria-expanded="false"/)
    assert.match(markup, /Show 2 more monthly spending plans/)
    assert.doesNotMatch(markup, /Plan 6|Plan 7/)
    assert.doesNotMatch(fittingMarkup, /category-spending-actions|aria-expanded=/)
    assert.match(singularMarkup, /Show 1 more monthly spending plan</)
    assert.match(privateMarkup, /HK\$••••/)
    assert.match(privateMarkup, /Sensitive text hidden/)
    assert.doesNotMatch(privateMarkup, /HK\$100\.00|50%|remaining| over/)
  })
})
