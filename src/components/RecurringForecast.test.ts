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

function renderForecast(
  privacyMode: boolean,
  summary: Summary = unsafeSummary,
  accounts: ReadonlyArray<{ id: number; name: string; localizationKey: string | null }> = [],
  categories: ReadonlyArray<{ id: number; name: string; localizationKey: string | null }> = [],
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
    localizeEntityName: (name, localizationKey) => localizationKey
      ? `${localizationKey}:${name}`
      : name,
  }

  return renderToStaticMarkup(createElement(
    I18nContext.Provider,
    { value: context },
    createElement(RecurringForecast, {
      summary,
      accounts,
      categories,
      loading: false,
      onManage: () => undefined,
      onManageTransfer: () => undefined,
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

  it('keeps the exact rule identity on every actionable occurrence', () => {
    const markup = renderForecast(false)

    assert.match(markup, /data-recurring-rule-id="10000000-0000-4000-8000-000000000001"/)
    assert.match(markup, /data-recurring-rule-id="10000000-0000-4000-8000-000000000002"/)
  })

  it('adds existing account and category context without breaking older API responses', () => {
    const contextualSummary: Summary = {
      ...unsafeSummary,
      recurringForecast: [{
        ...unsafeSummary.recurringForecast[0],
        amountMinor: 8_000,
        payee: 'Provider Ltd',
        accountId: 2,
        categoryId: 7,
      }],
    }
    const accounts = [{
      id: 2,
      name: 'Renamed everyday account',
      localizationKey: null,
      isActive: false,
    }]
    const categories = [{
      id: 7,
      name: 'Renamed utilities',
      localizationKey: null,
      isActive: false,
    }]
    const markup = renderForecast(false, contextualSummary, accounts, categories)
    const privateMarkup = renderForecast(true, contextualSummary, accounts, categories)
    const missingReferencesMarkup = renderForecast(false, contextualSummary)
    const partialContextMarkup = renderForecast(false, {
      ...contextualSummary,
      recurringForecast: [{
        ...contextualSummary.recurringForecast[0],
        categoryId: undefined,
      }],
    }, accounts, categories)
    const olderApiMarkup = renderForecast(false)

    assert.match(markup, /dateTime="2026-07-01">2026-07-01<\/time> · Provider Ltd · Monthly/)
    assert.match(markup, /Renamed everyday account · Renamed utilities/)
    assert.match(markup, /aria-label="Manage First large entry:[^"]*Account \/ category: Renamed everyday account · Renamed utilities\."/)
    assert.match(privateMarkup, /aria-label="Manage First large entry:[^"]*HK\$••••[^"]*Renamed everyday account · Renamed utilities/)
    assert.match(privateMarkup, /HK\$••••/)
    assert.doesNotMatch(privateMarkup, /HK\$80\.00/)
    assert.match(missingReferencesMarkup, /Unknown account · Unknown category/)
    assert.doesNotMatch(partialContextMarkup, /recurring-forecast-reference/)
    assert.doesNotMatch(olderApiMarkup, /Unknown account|Unknown category|recurring-forecast-reference/)
  })

  it('renders scheduled transfers separately without creating cash-flow totals', () => {
    const transferSummary: Summary = {
      ...unsafeSummary,
      recurringForecast: [],
      recurringTransferForecast: [{
        recurringTransferRuleId: '20000000-0000-4000-8000-000000000001',
        name: 'Daily savings',
        amountMinor: 4_500,
        fromAccountId: 2,
        fromAccountName: 'Everyday',
        fromAccountLocalizationKey: 'account.bank',
        toAccountId: 3,
        toAccountName: 'Reserve',
        toAccountLocalizationKey: 'account.wallet',
        frequency: 'daily',
        firstOccurrenceOn: '2026-07-01',
        occurrenceCount: 7,
        occurrenceDates: [
          '2026-07-01',
          '2026-07-02',
          '2026-07-03',
          '2026-07-04',
          '2026-07-05',
          '2026-07-06',
          '2026-07-07',
        ],
      }],
    }
    const markup = renderForecast(false, transferSummary)
    const privateMarkup = renderForecast(true, transferSummary)

    assert.match(markup, /Scheduled account transfers/)
    assert.match(markup, /ledger generation dates, not bank execution dates/)
    assert.match(markup, /data-recurring-transfer-rule-id="20000000-0000-4000-8000-000000000001"/)
    assert.match(markup, /2026-07-01<\/time> · Daily/)
    assert.match(markup, /account\.bank:Everyday → account\.wallet:Reserve/)
    assert.match(markup, /HK\$45\.00/)
    assert.doesNotMatch(markup, /class="recurring-forecast-totals"/)
    assert.doesNotMatch(markup, /class="recurring-forecast-periods"/)
    assert.doesNotMatch(markup, /2026-07-07/)
    assert.match(markup, /Show 1 more scheduled account transfer/)
    assert.match(privateMarkup, /HK\$••••/)
    assert.doesNotMatch(privateMarkup, /HK\$45\.00/)
  })
})
