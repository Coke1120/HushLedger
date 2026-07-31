import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nContext, type I18nContextValue } from '../i18n/context'
import { translate } from '../i18n/core'
import { formatMoneyForDisplay } from '../lib/privacy'
import {
  OverviewMonthlyReview,
  type OverviewReview,
} from './OverviewMonthlyReview'

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')

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

const sections: Readonly<Record<OverviewReview, ReturnType<typeof createElement>>> = {
  netWorth: createElement('div', null, 'net-worth-content'),
  cashFlow: createElement('div', null, 'cash-flow-content'),
  income: createElement('div', null, 'income-content'),
  spending: createElement('div', null, 'spending-content'),
  plans: createElement('div', null, 'plans-content'),
  outlook: createElement('div', null, 'outlook-content'),
}

describe('overview monthly review', () => {
  it('renders one selected insight with an accessible tab relationship', () => {
    const markup = renderToStaticMarkup(createElement(
      I18nContext.Provider,
      { value: context },
      createElement(OverviewMonthlyReview, {
        selected: 'spending',
        content: sections,
        onChange: () => undefined,
      }),
    ))

    assert.equal(markup.match(/role="tab"/g)?.length, 6)
    assert.match(markup, /aria-selected="true"[^>]*>Spending breakdown/)
    assert.match(markup, /role="tabpanel" aria-labelledby="overview-review-tab-spending"/)
    assert.match(markup, /spending-content/)
    assert.doesNotMatch(markup, /net-worth-content/)
    assert.doesNotMatch(markup, /cash-flow-content/)
  })

  it('keeps month navigation available outside the overview-only region', () => {
    const monthNavigatorIndex = appSource.indexOf('<MonthNavigator')
    const overviewRegionIndex = appSource.indexOf('<div className="overview-region">')

    assert.ok(monthNavigatorIndex >= 0)
    assert.ok(overviewRegionIndex > monthNavigatorIndex)
  })

  it('explains when the overview transaction preview still has active filters', () => {
    assert.match(appSource, /const overviewTransactionFiltersActive =/)
    assert.match(appSource, /view === 'overview' && overviewTransactionFiltersActive/)
    assert.match(appSource, /t\('overviewTransactionFiltersActive'\)/)
    assert.match(appSource, /onClick=\{\(\) => changeView\('transactions'\)\}/)
  })
})
