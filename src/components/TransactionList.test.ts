import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nContext, type I18nContextValue } from '../i18n/context'
import { translate } from '../i18n/core'
import { formatMoneyForDisplay } from '../lib/privacy'
import type { Transaction } from '../lib/schema'
import {
  TransactionImportReviewBulkControl,
  TransactionList,
} from './TransactionList'

const baseTransaction: Transaction = {
  id: '248e3e55-d864-4a32-bf48-46bd3608060f',
  type: 'expense',
  amountMinor: 12_345,
  currency: 'HKD',
  accountId: 1,
  categoryId: 3,
  occurredOn: '2026-07-14',
  cleared: true,
  payee: 'Imported row',
  note: '',
  accountName: 'Bank',
  accountLocalizationKey: null,
  categoryName: 'Food',
  categoryLocalizationKey: null,
  categoryIcon: 'utensils',
  categoryColor: '#123456',
  createdAt: '2026-07-14T00:00:00.000Z',
  updatedAt: '2026-07-14T00:00:00.000Z',
  importReviewStatus: 'unreviewed',
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

describe('transaction import checklist', () => {
  it('renders a structured state pill only for imported rows', () => {
    const transactions: Transaction[] = [
      baseTransaction,
      {
        ...baseTransaction,
        id: '86192038-dc31-4672-ab86-d750adee2095',
        payee: 'Follow-up row',
        importReviewStatus: 'needs_follow_up',
      },
      {
        ...baseTransaction,
        id: 'c329b96d-1a1a-4108-8fbb-d3f69ced761b',
        payee: 'Reviewed row',
        importReviewStatus: 'reviewed',
      },
      {
        ...baseTransaction,
        id: 'ad301dea-caf6-477a-995c-a746b24f2100',
        payee: 'Manual row',
        importReviewStatus: null,
      },
    ]

    const markup = renderToStaticMarkup(createElement(
      I18nContext.Provider,
      { value: context },
      createElement(TransactionList, {
        transactions,
        categories: [],
        loading: false,
        tagFilter: null,
        duplicateReview: false,
        allowBulkActions: true,
        saving: false,
        onEdit: () => undefined,
        onTagSelect: () => undefined,
        onSetCategory: async () => true,
        onSetClearing: async () => true,
        onSetImportReviewStatus: async () => true,
      }),
    ))

    assert.match(markup, /transaction-import-review-status is-unreviewed[^>]*title="Import checklist: unreviewed"[^>]*>Imported · Unreviewed/)
    assert.match(markup, /transaction-import-review-status is-needs_follow_up[^>]*title="Import checklist: needs follow-up"[^>]*>Imported · Follow-up/)
    assert.match(markup, /transaction-import-review-status is-reviewed[^>]*title="Import checklist: reviewed"[^>]*>Imported · Reviewed/)
    assert.equal(markup.match(/transaction-import-review-status/g)?.length, 3)
  })

  it('enables a chosen checklist change when every selected row is imported', () => {
    const markup = renderToStaticMarkup(createElement(
      I18nContext.Provider,
      { value: context },
      createElement(TransactionImportReviewBulkControl, {
        transactions: [baseTransaction],
        busy: false,
        status: 'reviewed',
        onStatusChange: () => undefined,
        onApply: () => undefined,
      }),
    ))

    assert.doesNotMatch(markup, /<select[^>]*disabled=""/)
    assert.doesNotMatch(markup, /<button[^>]*disabled=""/)
    assert.match(markup, /Only imported transactions have this local checklist\./)
  })

  it('disables the checklist controls and explains a mixed manual selection', () => {
    const markup = renderToStaticMarkup(createElement(
      I18nContext.Provider,
      { value: context },
      createElement(TransactionImportReviewBulkControl, {
        transactions: [
          baseTransaction,
          { ...baseTransaction, id: '86192038-dc31-4672-ab86-d750adee2095', importReviewStatus: null },
        ],
        busy: false,
        status: null,
        onStatusChange: () => undefined,
        onApply: () => undefined,
      }),
    ))

    assert.match(markup, /<select[^>]*disabled=""/)
    assert.match(markup, /<button[^>]*disabled=""/)
    assert.match(markup, /This selection includes a manual transaction\. Import checklist actions are available only when every selected row is imported\./)
  })
})
