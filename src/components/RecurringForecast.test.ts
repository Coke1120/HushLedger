import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nContext, type I18nContextValue } from '../i18n/context'
import { translate } from '../i18n/core'
import { formatMoneyForDisplay } from '../lib/privacy'
import type { Summary } from '../lib/schema'
import { RecurringForecast } from './RecurringForecast'

const unsafeSummary: Summary = {
  month: '2026-07',
  income: 0,
  expense: 0,
  balance: 0,
  cashFlowTrend: [],
  spendingTrend: [],
  expenseByCategory: [],
  expenseByPayee: [],
  monthlySpendingPlans: [],
  recurringForecast: [
    {
      recurringRuleId: '10000000-0000-4000-8000-000000000001',
      name: 'First large entry',
      type: 'expense',
      amountMinor: Number.MAX_SAFE_INTEGER,
      payee: '',
      frequency: 'monthly',
      firstOccurrenceOn: '2026-07-01',
      occurrenceCount: 1,
      occurrenceDates: ['2026-07-01'],
    },
    {
      recurringRuleId: '10000000-0000-4000-8000-000000000002',
      name: 'Second entry',
      type: 'expense',
      amountMinor: 1,
      payee: '',
      frequency: 'monthly',
      firstOccurrenceOn: '2026-07-07',
      occurrenceCount: 1,
      occurrenceDates: ['2026-07-07'],
    },
  ],
}

function renderForecast(privacyMode: boolean) {
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
    createElement(RecurringForecast, {
      summary: unsafeSummary,
      loading: false,
      onManage: () => undefined,
    }),
  ))
}

function periodTotalsCount(markup: string) {
  return markup.match(/class="recurring-forecast-period-totals"/g)?.length ?? 0
}

describe('recurring forecast privacy rendering', () => {
  it('keeps unsafe totals structurally indistinguishable while amounts are masked', () => {
    const markup = renderForecast(true)

    assert.equal(periodTotalsCount(markup), 5)
    assert.match(markup, /class="recurring-forecast-totals"/)
    assert.doesNotMatch(markup, /Scheduled totals for this period are outside/)
    assert.doesNotMatch(markup, /9007199254740991/)
    assert.match(markup, /HK\$••••/)
    assert.match(markup, /aria-label="2026-07-01 to 2026-07-07"/)
  })

  it('still reports an unsafe period when screen privacy is off', () => {
    const markup = renderForecast(false)

    assert.equal(periodTotalsCount(markup), 4)
    assert.doesNotMatch(markup, /class="recurring-forecast-totals"/)
    assert.match(markup, /Scheduled totals for this period are outside/)
  })
})
