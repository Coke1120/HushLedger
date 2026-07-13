import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nContext, type I18nContextValue } from '../i18n/context'
import { translate } from '../i18n/core'
import { formatMoneyForDisplay } from '../lib/privacy'
import type { AccountRegister as AccountRegisterData } from '../lib/schema'
import { AccountRegister } from './AccountRegister'

const register: AccountRegisterData = {
  accountId: 7,
  accountName: 'Statement account',
  accountLocalizationKey: null,
  month: '2026-07',
  dateFrom: '2026-06-13',
  dateTo: '2026-07-12',
  availableFrom: null,
  startingBalanceMinor: 100_000,
  endingBalanceMinor: 98_000,
  clearedEndingBalanceMinor: 99_000,
  unclearedEndingBalanceMinor: -1_000,
  unclearedCount: 1,
  entryCount: 0,
  entries: [],
}

function renderRegister(
  privacyMode: boolean,
  accountId = register.accountId,
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
    formatNumber: (value) => String(value),
    localizeEntityName: (name) => name,
  }

  return renderToStaticMarkup(createElement(
    I18nContext.Provider,
    { value: context },
    createElement(AccountRegister, {
      accountId,
      register,
      dateFrom: register.dateFrom,
      dateTo: register.dateTo,
      transactions: [],
      transfers: [],
      loading: false,
      saving: false,
      reconcileInitially: true,
      onClose: () => undefined,
      onDateRangeChange: () => undefined,
      onEditTransaction: () => undefined,
      onEditTransfer: () => undefined,
      onSetTransactionCleared: async () => true,
      onSetTransferCleared: async () => true,
    }),
  ))
}

describe('statement-period reconciliation', () => {
  it('renders an inclusive cross-month period and server-authoritative cutoff balances', () => {
    const markup = renderRegister(false)

    assert.match(markup, /2026-06-13 through 2026-07-12/)
    assert.match(markup, /value="2026-06-13"/)
    assert.match(markup, /value="2026-07-12"/)
    assert.match(markup, /Recorded balance[\s\S]*HK\$980\.00/)
    assert.match(markup, /Cleared balance[\s\S]*HK\$990\.00/)
    assert.match(markup, /Uncleared net[\s\S]*-HK\$10\.00/)
    assert.match(markup, /1 uncleared entry remains through the statement close/)
  })

  it('keeps the statement balance ephemeral and masked under screen privacy', () => {
    const markup = renderRegister(true)

    assert.match(markup, /Ledger queries send the selected account and period to the same-origin HushLedger API/)
    assert.match(markup, /type="password"/)
    assert.match(markup, /autoComplete="off"/)
    assert.doesNotMatch(markup, /HK\$980\.00|HK\$990\.00|-HK\$10\.00/)
  })

  it('never renders a prior account snapshot while another account is loading', () => {
    const markup = renderRegister(false, register.accountId + 1)

    assert.match(markup, /Organizing the account register/)
    assert.doesNotMatch(markup, /Statement account register|HK\$980\.00|Mark as cleared/)
  })
})
