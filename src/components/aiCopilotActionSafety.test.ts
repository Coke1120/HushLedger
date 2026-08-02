import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AiCopilotAction } from '../lib/aiCopilot'
import type { Account, Category } from '../lib/schema'
import { aiCopilotActionIsCurrent } from './aiCopilotActionSafety'

const accounts = [
  {
    id: 1,
    name: 'Cash',
    type: 'cash',
    currency: 'HKD',
    isActive: true,
    sortOrder: 0,
    localizationKey: null,
    openingBalanceMinor: null,
    openingBalanceOn: null,
    updatedAt: '2026-08-01T00:00:00.000Z',
  },
] satisfies Account[]

const categories = [
  {
    id: 2,
    name: 'Food',
    type: 'expense',
    icon: 'utensils',
    color: '#000000',
    isActive: true,
    sortOrder: 0,
    localizationKey: null,
    monthlyPlanMinor: null,
    updatedAt: '2026-08-01T00:00:00.000Z',
  },
] satisfies Category[]

const showTransactions = {
  type: 'show_transactions',
  filters: {
    transactionType: 'expense',
    categoryId: 2,
    importReviewStatus: 'all',
    duplicatesOnly: false,
    search: null,
  },
} satisfies AiCopilotAction

const transactionDraft = {
  type: 'draft_transaction',
  input: {
    id: '00000000-0000-4000-8000-000000000001',
    type: 'expense',
    amountMinor: 100,
    currency: 'HKD',
    accountId: 1,
    categoryId: 2,
    occurredOn: '2026-08-01',
    cleared: false,
    payee: '',
    note: '',
  },
} satisfies AiCopilotAction

const recurringDraft = {
  type: 'draft_recurring_rule',
  input: {
    id: '00000000-0000-4000-8000-000000000002',
    name: 'Lunch',
    type: 'expense',
    amountMinor: 100,
    currency: 'HKD',
    accountId: 1,
    categoryId: 2,
    frequency: 'monthly',
    scheduleStartsOn: '2026-08-01',
    scheduleEndsOn: null,
    isActive: true,
    payee: '',
    note: '',
  },
} satisfies AiCopilotAction

describe('AI Copilot action freshness', () => {
  it('rejects a stale or type-mismatched show-transactions category', () => {
    assert.equal(aiCopilotActionIsCurrent(showTransactions, accounts, categories), true)
    assert.equal(aiCopilotActionIsCurrent(showTransactions, accounts, []), false)
    assert.equal(aiCopilotActionIsCurrent(showTransactions, accounts, [
      { ...categories[0], isActive: false },
    ]), false)
    assert.equal(aiCopilotActionIsCurrent(showTransactions, accounts, [
      { ...categories[0], type: 'income' },
    ]), false)
  })

  it('rejects transaction drafts with stale, mismatched, or changed-currency references', () => {
    assert.equal(aiCopilotActionIsCurrent(transactionDraft, accounts, categories), true)
    assert.equal(aiCopilotActionIsCurrent(transactionDraft, [], categories), false)
    assert.equal(aiCopilotActionIsCurrent(transactionDraft, accounts, []), false)
    assert.equal(aiCopilotActionIsCurrent(transactionDraft, [
      { ...accounts[0], isActive: false },
    ], categories), false)
    assert.equal(aiCopilotActionIsCurrent(transactionDraft, [
      { ...accounts[0], currency: 'USD' },
    ], categories), false)
    assert.equal(aiCopilotActionIsCurrent(transactionDraft, accounts, [
      { ...categories[0], type: 'income' },
    ]), false)
  })

  it('rejects recurring drafts when either live reference became stale', () => {
    assert.equal(aiCopilotActionIsCurrent(recurringDraft, accounts, categories), true)
    assert.equal(aiCopilotActionIsCurrent(recurringDraft, [], categories), false)
    assert.equal(aiCopilotActionIsCurrent(recurringDraft, accounts, [
      { ...categories[0], isActive: false },
    ]), false)
  })
})
