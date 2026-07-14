import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nContext, type I18nContextValue } from '../i18n/context'
import { translate } from '../i18n/core'
import { formatMoneyForDisplay } from '../lib/privacy'
import type { AccountBalance } from '../lib/schema'
import { AccountBalances } from './AccountBalances'

type BalanceWithUnclearedCount = AccountBalance & { unclearedCount?: number | null }

function balance(
  accountId: number,
  accountName: string,
  unclearedCount: number | null | undefined,
): BalanceWithUnclearedCount {
  return {
    accountId,
    accountName,
    accountLocalizationKey: null,
    accountType: 'bank',
    currency: 'HKD',
    isActive: true,
    openingBalanceMinor: null,
    openingBalanceOn: null,
    recordedBalance: 100_000,
    clearedBalance: 100_000,
    unclearedBalance: 0,
    ...(unclearedCount === undefined ? {} : { unclearedCount }),
  }
}

function renderBalances(balances: BalanceWithUnclearedCount[]) {
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
    formatNumber: (value) => String(value),
    localizeEntityName: (name) => name,
  }

  return renderToStaticMarkup(createElement(
    I18nContext.Provider,
    { value: context },
    createElement(AccountBalances, {
      balances,
      month: '2026-07',
      loading: false,
      canReconcile: true,
      onReview: () => undefined,
      onCompare: () => undefined,
    }),
  ))
}

describe('account balance uncleared activity', () => {
  it('distinguishes zero, singular, and plural uncleared entries through month-end', () => {
    const markup = renderBalances([
      balance(1, 'Zero account', 0),
      balance(2, 'Singular account', 1),
      balance(3, 'Plural account', 2),
    ])

    assert.match(markup, /Uncleared through month-end/)
    assert.match(markup, />0 entries</)
    assert.match(markup, />1 entry</)
    assert.match(markup, />2 entries</)
  })

  it('does not fabricate a count for an older API payload or an unavailable balance', () => {
    const unavailable = {
      ...balance(2, 'Future account', null),
      openingBalanceMinor: 100_000,
      openingBalanceOn: '2026-08-01',
      recordedBalance: null,
      clearedBalance: null,
      unclearedBalance: null,
    }
    const markup = renderBalances([
      balance(1, 'Older payload account', undefined),
      unavailable,
    ])

    assert.match(markup, /Older payload account/)
    assert.match(markup, /HK\$1,000\.00/)
    assert.match(markup, /This balance can only be calculated from 2026-08-01\./)
    assert.doesNotMatch(markup, /undefined|NaN|Uncleared through month-end/)
  })
})
