import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nContext, type I18nContextValue } from '../i18n/context'
import { translate } from '../i18n/core'
import { formatMoneyForDisplay } from '../lib/privacy'
import type { AccountTransfer } from '../lib/schema'
import { AccountTransferList } from './AccountTransferList'

const context: I18nContextValue = {
  locale: 'en',
  setLocale: () => undefined,
  ledgerCurrency: 'HKD',
  setLedgerCurrency: () => undefined,
  privacyMode: false,
  setPrivacyMode: () => undefined,
  t: (key, values) => translate('en', key, values),
  formatMoney: (minor, currency = 'HKD') => formatMoneyForDisplay(minor, currency, 'en', false),
  formatMonth: String,
  formatDate: String,
  formatNumber: String,
  localizeEntityName: (name) => name,
}

function transfer(overrides: Partial<AccountTransfer>): AccountTransfer {
  return {
    id: crypto.randomUUID(),
    amountMinor: 10_000,
    currency: 'HKD',
    fromAccountId: 1,
    toAccountId: 2,
    occurredOn: '2026-07-14',
    fromCleared: false,
    toCleared: false,
    note: '',
    fromAccountName: 'Everyday',
    fromAccountLocalizationKey: null,
    toAccountName: 'Savings',
    toAccountLocalizationKey: null,
    createdAt: '2026-07-14T00:00:00.000Z',
    updatedAt: '2026-07-14T00:00:00.000Z',
    ...overrides,
  }
}

describe('account transfer recurrence provenance', () => {
  it('labels generated transfers without relabelling manual transfers', () => {
    const generatedRuleId = crypto.randomUUID()
    const markup = renderToStaticMarkup(createElement(
      I18nContext.Provider,
      { value: context },
      createElement(AccountTransferList, {
        transfers: [
          transfer({}),
          transfer({
            recurringTransferRuleId: generatedRuleId,
            recurringTransferRuleName: 'Monthly savings',
            recurrenceDueOn: '2026-07-14',
            recurringOccurrenceKey: `${generatedRuleId}:2026-07-14`,
          }),
        ],
        loading: false,
        available: true,
        onAdd: () => undefined,
        onEdit: () => undefined,
      }),
    ))

    assert.equal(markup.match(/Scheduled: Monthly savings/g)?.length, 1)
  })
})
