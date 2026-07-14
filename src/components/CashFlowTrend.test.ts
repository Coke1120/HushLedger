import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nContext, type I18nContextValue } from '../i18n/context'
import { translate, type Locale } from '../i18n/core'
import type { SupportedCurrency } from '../lib/currency'
import { formatMonthLabel } from '../lib/date'
import { formatMoneyForDisplay } from '../lib/privacy'
import type { Summary } from '../lib/schema'
import { CashFlowTrend } from './CashFlowTrend'

const summary: Summary = {
  month: '2026-07',
  income: 140_000,
  expense: 103_500,
  balance: 36_500,
  cashFlowTrend: [
    { month: '2026-02', incomeMinor: 0, expenseMinor: 0, netMinor: 0, transactionCount: 0 },
    { month: '2026-03', incomeMinor: 90_000, expenseMinor: 80_000, netMinor: 10_000, transactionCount: 4 },
    { month: '2026-04', incomeMinor: 100_000, expenseMinor: 95_000, netMinor: 5_000, transactionCount: 5 },
    { month: '2026-05', incomeMinor: 110_000, expenseMinor: 98_000, netMinor: 12_000, transactionCount: 6 },
    { month: '2026-06', incomeMinor: 125_000, expenseMinor: 91_000, netMinor: 34_000, transactionCount: 7 },
    { month: '2026-07', incomeMinor: 140_000, expenseMinor: 103_500, netMinor: 36_500, transactionCount: 8 },
  ],
  spendingTrend: [],
  expenseByCategory: [],
  expenseByPayee: [],
  monthlySpendingPlans: [],
  recurringForecast: [],
}

function renderCashFlowTrend(
  source = summary,
  privacyMode = false,
  loading = false,
  locale: Locale = 'en',
  currentMonth = '2026-07',
  ledgerCurrency: SupportedCurrency = 'HKD',
) {
  const context: I18nContextValue = {
    locale,
    setLocale: () => undefined,
    ledgerCurrency,
    setLedgerCurrency: () => undefined,
    privacyMode,
    setPrivacyMode: () => undefined,
    t: (key, values) => translate(locale, key, values),
    formatMoney: (minor, currency = ledgerCurrency) => formatMoneyForDisplay(
      minor,
      currency,
      locale,
      privacyMode,
    ),
    formatMonth: (month) => formatMonthLabel(month, locale),
    formatDate: (date) => date,
    formatNumber: String,
    localizeEntityName: (name) => name,
  }

  return renderToStaticMarkup(createElement(
    I18nContext.Provider,
    { value: context },
    createElement(CashFlowTrend, {
      summary: source,
      currentMonth,
      loading,
      onSelectMonth: () => undefined,
    }),
  ))
}

describe('selected-month recorded cash-flow comparison', () => {
  it('shows exact neutral differences from the immediately previous month', () => {
    const markup = renderCashFlowTrend()

    assert.match(markup, /Change from June 2026/)
    assert.match(markup, /<dt>Income<\/dt><dd[^>]*>\+HK\$150\.00<\/dd>/)
    assert.match(markup, /<dt>Expense<\/dt><dd[^>]*>\+HK\$125\.00<\/dd>/)
    assert.match(markup, /<dt>Net<\/dt><dd[^>]*>\+HK\$25\.00<\/dd>/)
    assert.doesNotMatch(markup, /better|worse|good|bad|saved/i)
  })

  it('renders decreases and zero changes without adding a positive sign or rating', () => {
    const markup = renderCashFlowTrend({
      ...summary,
      cashFlowTrend: [
        { month: '2026-06', incomeMinor: 100, expenseMinor: 80, netMinor: 20, transactionCount: 2 },
        { month: '2026-07', incomeMinor: 50, expenseMinor: 80, netMinor: -30, transactionCount: 2 },
      ],
    })

    assert.match(markup, /<dt>Income<\/dt><dd[^>]*>-HK\$0\.50<\/dd>/)
    assert.match(markup, /<dt>Expense<\/dt><dd[^>]*>HK\$0\.00<\/dd>/)
    assert.match(markup, /<dt>Net<\/dt><dd[^>]*>-HK\$0\.50<\/dd>/)
    assert.doesNotMatch(markup, /\+HK\$0\.00|better|worse|good|bad|saved/i)
  })

  it('keeps a safe-integer boundary difference exact on screen', () => {
    const markup = renderCashFlowTrend({
      ...summary,
      cashFlowTrend: [
        { month: '2026-06', incomeMinor: 0, expenseMinor: 0, netMinor: 0, transactionCount: 0 },
        {
          month: '2026-07',
          incomeMinor: Number.MAX_SAFE_INTEGER,
          expenseMinor: 0,
          netMinor: Number.MAX_SAFE_INTEGER,
          transactionCount: 1,
        },
      ],
    })

    assert.equal(markup.match(/\+HK\$90,071,992,547,409\.91/g)?.length, 2)
    assert.doesNotMatch(markup, /90,071,992,547,409\.90/)
  })

  it('hides direction and magnitude in privacy mode', () => {
    const markup = renderCashFlowTrend(summary, true)

    assert.equal(markup.match(/HK\$••••/g)?.length, 3)
    assert.doesNotMatch(markup, /\+HK\$|150\.00|125\.00|25\.00/)
    assert.match(markup, /recorded changes are hidden/i)
  })

  it('uses the selected ledger currency for visible differences and private masks', () => {
    const visibleMarkup = renderCashFlowTrend(summary, false, false, 'en', '2026-07', 'USD')
    const privateMarkup = renderCashFlowTrend(summary, true, false, 'en', '2026-07', 'USD')

    assert.match(visibleMarkup, /<dt>Income<\/dt><dd[^>]*>\+\$150\.00<\/dd>/)
    assert.equal(privateMarkup.match(/\$••••/g)?.length, 3)
    assert.doesNotMatch(privateMarkup, /HK\$|150\.00|125\.00|25\.00/)
  })

  it('keeps unavailable differences structurally hidden in privacy mode', () => {
    const markup = renderCashFlowTrend({
      ...summary,
      cashFlowTrend: summary.cashFlowTrend.map((point) => point.month === '2026-06'
        ? { ...point, incomeMinor: null, netMinor: null }
        : point),
    }, true)

    assert.equal(markup, renderCashFlowTrend(summary, true))
    assert.equal(markup.match(/HK\$••••/g)?.length, 3)
    assert.doesNotMatch(markup, /Cannot calculate safely|150\.00|25\.00|\+HK\$/)
  })

  it('marks only unsafe differences unavailable without inventing a zero', () => {
    const markup = renderCashFlowTrend({
      ...summary,
      cashFlowTrend: summary.cashFlowTrend.map((point) => point.month === '2026-06'
        ? { ...point, incomeMinor: null }
        : point),
    })

    assert.match(markup, /<dt>Income<\/dt><dd[^>]*>Cannot calculate safely<\/dd>/)
    assert.match(markup, /<dt>Expense<\/dt><dd[^>]*>\+HK\$125\.00<\/dd>/)
    assert.match(markup, /<dt>Net<\/dt><dd[^>]*>\+HK\$25\.00<\/dd>/)
  })

  it('omits comparison details during loading and when the previous month is absent', () => {
    assert.doesNotMatch(renderCashFlowTrend(summary, false, true), /Change from/)
    assert.doesNotMatch(renderCashFlowTrend({
      ...summary,
      cashFlowTrend: summary.cashFlowTrend.slice(-1),
    }), /Change from/)
  })

  it('does not present zero-filled future months as observed declines', () => {
    const futureSummary: Summary = {
      ...summary,
      month: '2026-08',
      income: 0,
      expense: 0,
      balance: 0,
      cashFlowTrend: [
        ...summary.cashFlowTrend.slice(1),
        { month: '2026-08', incomeMinor: 0, expenseMinor: 0, netMinor: 0, transactionCount: 0 },
      ],
    }

    const markup = renderCashFlowTrend(futureSummary, false, false, 'en', '2026-07')
    assert.doesNotMatch(markup, /Change from July 2026|cash-flow-comparison/)
  })

  it('uses localized month and comparison copy outside English', () => {
    const markup = renderCashFlowTrend(summary, false, false, 'fr')

    assert.match(markup, /Écart par rapport à juin 2026/)
    assert.match(markup, /Différences exactes des revenus/)
    assert.doesNotMatch(markup, /\{month\}|Change from/)
  })
})
