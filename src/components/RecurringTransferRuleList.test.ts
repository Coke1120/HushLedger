import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nContext, type I18nContextValue } from '../i18n/context'
import { translate } from '../i18n/core'
import { formatMoneyForDisplay } from '../lib/privacy'
import type { Account, RecurringTransferRule } from '../lib/schema'
import { visibleRecurringTransferRules } from './recurringTransferVisibility'
import { RecurringTransferRuleList } from './RecurringTransferRuleList'

const accounts: Account[] = [
  {
    id: 1,
    name: 'Everyday',
    type: 'bank',
    currency: 'HKD',
    isActive: true,
    sortOrder: 1,
    localizationKey: null,
    openingBalanceMinor: null,
    openingBalanceOn: null,
    updatedAt: '2026-07-14T00:00:00.000Z',
  },
  {
    id: 2,
    name: 'Savings',
    type: 'bank',
    currency: 'HKD',
    isActive: true,
    sortOrder: 2,
    localizationKey: null,
    openingBalanceMinor: null,
    openingBalanceOn: null,
    updatedAt: '2026-07-14T00:00:00.000Z',
  },
]

function rule(overrides: Partial<RecurringTransferRule>): RecurringTransferRule {
  return {
    id: crypto.randomUUID(),
    name: 'Monthly savings',
    amountMinor: 50_000,
    currency: 'HKD',
    fromAccountId: 1,
    toAccountId: 2,
    frequency: 'monthly',
    scheduleStartsOn: '2026-07-15',
    scheduleEndsOn: null,
    nextOccurrenceOn: '2026-07-15',
    lastOccurrenceOn: null,
    anchorDay: 15,
    generatedCount: 0,
    isActive: true,
    note: 'Keep this private',
    lastErrorCode: null,
    revision: 1,
    fromAccountName: 'Everyday',
    toAccountName: 'Savings',
    createdAt: '2026-07-14T00:00:00.000Z',
    updatedAt: '2026-07-14T00:00:00.000Z',
    ...overrides,
  }
}

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

function renderRules(rules: RecurringTransferRule[], accountOptions = accounts) {
  return renderToStaticMarkup(createElement(
    I18nContext.Provider,
    { value: context },
    createElement(RecurringTransferRuleList, {
      accounts: accountOptions,
      loading: false,
      mutable: true,
      mutatingId: null,
      rules,
      onCreate: () => undefined,
      onDelete: async () => true,
      onEdit: () => undefined,
      onSetActive: async () => true,
      onSkip: async () => true,
    }),
  ))
}

describe('scheduled transfer rule cards', () => {
  it('hides live rules synchronously whenever the parent ledger is not live', () => {
    const liveRules = [rule({ name: 'Private savings route' })]

    assert.equal(visibleRecurringTransferRules('live', liveRules), liveRules)
    assert.deepEqual(visibleRecurringTransferRules('loading', liveRules), [])
    assert.deepEqual(visibleRecurringTransferRules('demo', liveRules), [])
    assert.deepEqual(visibleRecurringTransferRules('error', liveRules), [])
  })

  it('disables creation until two active accounts can form a transfer', () => {
    const markup = renderRules([], [accounts[0]])

    assert.match(markup, /<button[^>]*disabled=""[^>]*>.*Add scheduled transfer/)
  })

  it('keeps completed history editable while hiding actions that advance the schedule', () => {
    const markup = renderRules([
      rule({ name: 'Active transfer' }),
      rule({
        name: 'Completed transfer',
        isActive: false,
        scheduleEndsOn: '2026-06-15',
        nextOccurrenceOn: '2026-07-15',
        generatedCount: 3,
      }),
    ])

    assert.match(markup, /Everyday → Savings/)
    assert.match(markup, /Keep this private/)
    assert.match(markup, /Completed transfer/)
    assert.equal(markup.match(/>Skip next</g)?.length, 1)
    assert.equal(markup.match(/>Pause</g)?.length, 1)
    assert.equal(markup.match(/>Edit</g)?.length, 2)
    assert.equal(markup.match(/>Delete</g)?.length, 2)
    assert.doesNotMatch(markup, />Resume</)
  })
})
