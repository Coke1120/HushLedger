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
  canExport = true,
  dateFrom = register.dateFrom,
  dateTo = register.dateTo,
  registerData = register,
  initialStatementBalanceMinor: number | null = null,
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
      currency: 'HKD',
      register: registerData,
      canExport,
      snapshotVersion: 1,
      dateFrom,
      dateTo,
      transactions: [],
      transfers: [],
      loading: false,
      saving: false,
      reconcileInitially: true,
      initialStatementBalanceMinor,
      onClose: () => undefined,
      onDateRangeChange: () => undefined,
      onEditTransaction: () => undefined,
      onEditTransfer: () => undefined,
      onSetEntryCleared: async () => true,
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
    assert.match(markup, /plaintext and includes exact amounts even when screen privacy is on/)
    assert.match(markup, /Only after you press the button, this browser sends the account ID and close date/)
    assert.match(markup, /same-origin private HushLedger API/)
    assert.match(markup, /returns exact out-of-period uncleared rows to this screen’s temporary memory/)
    assert.match(markup, /not saved in browser storage or sent to a third party/)
    assert.match(markup, /type="password"/)
    assert.match(markup, /autoComplete="off"/)
    assert.doesNotMatch(markup, /HK\$980\.00|HK\$990\.00|-HK\$10\.00/)
  })

  it('prefills a handed-off closing balance while keeping it editable and ephemeral', () => {
    const markup = renderRegister(false, register.accountId, true, register.dateFrom,
      register.dateTo, register, -12_345)

    assert.match(markup, /value="-123\.45"/)
    assert.match(markup, /value="2026-06-13"/)
    assert.match(markup, /value="2026-07-12"/)
    assert.doesNotMatch(markup, /readonly/)
  })

  it('never renders a prior account snapshot while another account is loading', () => {
    const markup = renderRegister(false, register.accountId + 1)

    assert.match(markup, /Organizing the account register/)
    assert.doesNotMatch(markup, /Statement account register|HK\$980\.00|Mark as cleared/)
  })

  it('exports only a current live account range and explains the plaintext boundary', () => {
    const liveMarkup = renderRegister(false)
    const unavailableMarkup = renderRegister(false, register.accountId, false)
    const staleRangeMarkup = renderRegister(
      false,
      register.accountId,
      true,
      '2026-06-14',
      register.dateTo,
    )

    assert.match(liveMarkup, /Export register CSV/)
    assert.match(liveMarkup, /without the 200-row screen limit/)
    assert.doesNotMatch(liveMarkup, /account-register-export"[^>]*disabled/)
    assert.match(unavailableMarkup, /account-register-export"[^>]*disabled/)
    assert.match(staleRangeMarkup, /account-register-export"[^>]*disabled/)
    assert.match(unavailableMarkup, /Connect to the private ledger before exporting this register/)
  })

  it('requires an explicit request before offering the complete out-of-period review', () => {
    const markup = renderRegister(false)

    assert.match(markup, /older or out-of-period uncleared entr(?:y|ies) may not be loaded/i)
    assert.match(markup, />Load every uncleared entry</)
    assert.match(markup, /account-reconciliation-complete-review-privacy/)
    assert.match(
      translate('en', 'reconciliationReviewComplete', { count: 2, date: 'July 12' }),
      /Complete snapshot through July 12: all 2 uncleared entries are loaded/,
    )
    assert.match(
      translate('en', 'reconciliationReviewComplete', { count: 1, date: 'July 12' }),
      /Complete snapshot through July 12: the one uncleared entry is loaded/,
    )
    assert.match(
      translate('en', 'completeUnclearedReviewFailed'),
      /limited loaded range remains in use; try again/,
    )
  })

  it('keeps an uncapped review row clearable when its full editor record is not loaded', () => {
    const entry = {
      entryId: 'transaction:txn-old',
      sourceId: 'txn-old',
      kind: 'transaction' as const,
      updatedAt: '2026-07-14T08:00:00.000Z',
      occurredOn: '2026-06-20',
      amountMinor: -1_000,
      runningBalanceMinor: 99_000,
      cleared: false,
      payee: 'Old entry',
      note: '',
      categoryName: 'Food',
      categoryLocalizationKey: null,
      counterpartyAccountName: null,
      counterpartyAccountLocalizationKey: null,
      transferDirection: null,
    }
    const markup = renderRegister(
      false,
      register.accountId,
      true,
      register.dateFrom,
      register.dateTo,
      { ...register, entryCount: 1, entries: [entry] },
    )

    assert.match(markup, /Old entry/)
    assert.match(markup, /aria-label="Mark this entry cleared"/)
    assert.doesNotMatch(markup, /<span class="sr-only">Edit<\/span>/)
  })

})
