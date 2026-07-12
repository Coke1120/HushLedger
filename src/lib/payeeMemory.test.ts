import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { payeeOptions, rememberPayeeReferences } from './payeeMemory'
import type { Account, Category, PayeeSuggestion } from './schema'

const accounts: Account[] = [
  {
    id: 1,
    name: 'Bank',
    type: 'bank',
    currency: 'HKD',
    isActive: true,
    sortOrder: 10,
    localizationKey: null,
    updatedAt: '2026-07-13T00:00:00.000Z',
  },
  {
    id: 2,
    name: 'Old card',
    type: 'credit_card',
    currency: 'HKD',
    isActive: false,
    sortOrder: 20,
    localizationKey: null,
    updatedAt: '2026-07-13T00:00:00.000Z',
  },
]

const categories: Category[] = [
  {
    id: 3,
    name: 'Food',
    type: 'expense',
    icon: 'utensils',
    color: '#123456',
    isActive: true,
    sortOrder: 10,
    localizationKey: null,
    updatedAt: '2026-07-13T00:00:00.000Z',
  },
  {
    id: 4,
    name: 'Old income',
    type: 'income',
    icon: 'banknote',
    color: '#123456',
    isActive: false,
    sortOrder: 10,
    localizationKey: null,
    updatedAt: '2026-07-13T00:00:00.000Z',
  },
]

const suggestions: PayeeSuggestion[] = [
  { payee: 'Corner Cafe', type: 'expense', accountId: 1, categoryId: 3, lastUsedOn: '2026-07-12', useCount: 4 },
  { payee: 'Corner Cafe', type: 'income', accountId: 2, categoryId: 4, lastUsedOn: '2026-07-11', useCount: 1 },
]

describe('payee memory', () => {
  it('matches a known payee without case or surrounding-space sensitivity', () => {
    assert.deepEqual(
      rememberPayeeReferences(suggestions, '  corner CAFE ', 'expense', accounts, categories),
      { accountId: 1, categoryId: 3 },
    )
  })

  it('never revives inactive references or crosses transaction types', () => {
    assert.deepEqual(
      rememberPayeeReferences(suggestions, 'Corner Cafe', 'income', accounts, categories),
      { accountId: null, categoryId: null },
    )
    assert.equal(
      rememberPayeeReferences(suggestions, 'Unknown', 'expense', accounts, categories),
      null,
    )
  })

  it('offers only payees used for the selected transaction type', () => {
    assert.deepEqual(payeeOptions(suggestions, 'expense'), ['Corner Cafe'])
    assert.deepEqual(payeeOptions(suggestions, 'income'), ['Corner Cafe'])
  })
})
