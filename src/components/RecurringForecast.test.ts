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

const rollingUnsafeSummary: Summary = {
  ...unsafeSummary,
  scheduledOutlook: {
    startOn: '2026-07-01',
    endOnExclusive: '2026-08-05',
    recurringForecast: unsafeSummary.recurringForecast,
    recurringTransferForecast: [],
  },
}

const rollingSummary: Summary = {
  ...unsafeSummary,
  month: '2040-01',
  recurringForecast: [{
    ...unsafeSummary.recurringForecast[0],
    name: 'Selected month fallback',
    amountMinor: 9_900,
    firstOccurrenceOn: '2040-01-10',
    occurrenceDates: ['2040-01-10'],
  }],
  scheduledOutlook: {
    startOn: '2026-12-15',
    endOnExclusive: '2027-01-19',
    recurringForecast: [{
      ...unsafeSummary.recurringForecast[0],
      name: 'Rolling rent',
      amountMinor: 8_000,
      frequency: 'weekly',
      firstOccurrenceOn: '2026-12-15',
      occurrenceCount: 5,
      occurrenceDates: [
        '2026-12-15',
        '2026-12-22',
        '2026-12-29',
        '2027-01-05',
        '2027-01-12',
      ],
    }],
    recurringTransferForecast: [],
  },
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
  it('shows an absolute rolling range independently of the selected report month', () => {
    const markup = renderForecast(false, rollingSummary)

    assert.match(markup, /35-day scheduled ledger outlook/)
    assert.match(markup, /Ungenerated dates and amounts from active local ledger rules/)
    assert.match(markup, /not bank confirmation, actual transactions, available balance or runway, or guaranteed dates or amounts/)
    assert.match(markup, /class="sr-only">Outlook dates: December 15, 2026 through January 18, 2027, inclusive\.<\/p>/)
    assert.match(markup, /<p aria-hidden="true"><strong>Outlook dates:<\/strong>/)
    assert.doesNotMatch(markup, /<p[^>]*aria-label=/)
    assert.match(markup, /dateTime="2026-12-15">December 15, 2026/)
    assert.match(markup, /dateTime="2027-01-18">January 18, 2027/)
    assert.match(markup, /Rolling rent/)
    assert.match(markup, /Scheduled totals in 7-day periods/)
    assert.doesNotMatch(markup, /Scheduled cash flow by week/)
    assert.doesNotMatch(markup, /Selected month fallback|2040-01-10/)
    assert.equal(periodTotalsCount(markup), 5)
  })

  it('keeps an explicitly empty rolling outlook empty instead of falling back to the month', () => {
    const markup = renderForecast(false, {
      ...rollingSummary,
      scheduledOutlook: {
        ...rollingSummary.scheduledOutlook!,
        recurringForecast: [],
        recurringTransferForecast: [],
      },
    })

    assert.match(markup, /No ungenerated scheduled ledger entries in the next 35 days/)
    assert.match(markup, /December 15, 2026 through January 18, 2027/)
    assert.doesNotMatch(markup, /Selected month fallback|Rolling rent/)
    assert.doesNotMatch(markup, /class="recurring-forecast-totals"/)
  })

  it('falls back to the selected-month fields from an older API response', () => {
    const markup = renderForecast(false, unsafeSummary)

    assert.match(markup, /Scheduled ledger entries/)
    assert.match(markup, /First large entry/)
    assert.match(markup, /2026-07-01/)
    assert.doesNotMatch(markup, /Next 35 days|Outlook dates/)
  })

  it('keeps unsafe totals structurally indistinguishable while amounts are masked', () => {
    const markup = renderForecast(true, rollingUnsafeSummary)

    assert.equal(periodTotalsCount(markup), 5)
    assert.match(markup, /class="recurring-forecast-totals"/)
    assert.doesNotMatch(markup, /Scheduled totals for this period are outside/)
    assert.doesNotMatch(markup, /9007199254740991/)
    assert.match(markup, /HK\$••••/)
    assert.match(markup, /aria-label="2026-07-01 to 2026-07-07"/)
  })

  it('still reports an unsafe period when screen privacy is off', () => {
    const markup = renderForecast(false, rollingUnsafeSummary)

    assert.equal(periodTotalsCount(markup), 4)
    assert.doesNotMatch(markup, /class="recurring-forecast-totals"/)
    assert.match(markup, /Scheduled totals for this period are outside/)
  })

  it('keeps the exact rule identity on every actionable occurrence', () => {
    const markup = renderForecast(false, rollingUnsafeSummary)

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
    const transferForecast = [{
      recurringTransferRuleId: '20000000-0000-4000-8000-000000000001',
      name: 'Daily savings',
      amountMinor: 4_500,
      fromAccountId: 2,
      fromAccountName: 'Everyday',
      fromAccountLocalizationKey: 'account.bank' as const,
      toAccountId: 3,
      toAccountName: 'Reserve',
      toAccountLocalizationKey: 'account.wallet' as const,
      frequency: 'daily' as const,
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
    }]
    const transferSummary: Summary = {
      ...unsafeSummary,
      recurringTransferForecast: [],
      scheduledOutlook: {
        startOn: '2026-07-01',
        endOnExclusive: '2026-08-05',
        recurringForecast: [],
        recurringTransferForecast: transferForecast,
      },
    }
    const markup = renderForecast(false, transferSummary)
    const privateMarkup = renderForecast(true, transferSummary)

    assert.match(markup, /Scheduled account transfers/)
    assert.match(markup, /ledger generation dates, not bank execution dates/)
    assert.match(markup, /data-recurring-transfer-rule-id="20000000-0000-4000-8000-000000000001"/)
    assert.match(markup, /2026-07-01<\/time> · Daily/)
    assert.match(markup, /account\.bank:Everyday → account\.wallet:Reserve/)
    assert.match(markup, /HK\$45\.00/)
    assert.doesNotMatch(markup, /First large entry/)
    assert.doesNotMatch(markup, /class="recurring-forecast-totals"/)
    assert.doesNotMatch(markup, /class="recurring-forecast-periods"/)
    assert.doesNotMatch(markup, /2026-07-07/)
    assert.match(markup, /Show 1 more scheduled account transfer/)
    assert.match(privateMarkup, /HK\$••••/)
    assert.doesNotMatch(privateMarkup, /HK\$45\.00/)
  })
})
