import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { duplicateTransactionDraft } from './transactionDraft'
import type { Transaction } from './schema'

const transaction: Transaction = {
  id: '8be95494-259d-43c4-b047-37cd3d4038b7',
  type: 'expense',
  amountMinor: 4250,
  currency: 'HKD',
  accountId: 1,
  categoryId: 3,
  occurredOn: '2026-07-12',
  cleared: true,
  payee: 'Corner Cafe',
  note: 'Lunch',
  accountName: 'Bank',
  accountLocalizationKey: null,
  categoryName: 'Food',
  categoryLocalizationKey: null,
  categoryIcon: 'utensils',
  categoryColor: '#123456',
  createdAt: '2026-07-12T04:00:00.000Z',
  updatedAt: '2026-07-12T04:00:00.000Z',
  recurringRuleId: '27bb3e21-30f7-43c8-b946-f963d584b20a',
  recurringRuleName: 'Weekday lunch',
}

describe('duplicate transaction draft', () => {
  it('copies only editable ledger fields under a fresh id', () => {
    const id = 'c653fe75-e840-4627-aa18-d1c10a827646'

    assert.deepEqual(duplicateTransactionDraft(transaction, id), {
      id,
      type: 'expense',
      amountMinor: 4250,
      currency: 'HKD',
      accountId: 1,
      categoryId: 3,
      occurredOn: '2026-07-12',
      cleared: false,
      payee: 'Corner Cafe',
      note: 'Lunch',
    })
  })

  it('generates a different valid id when one is not supplied', () => {
    const draft = duplicateTransactionDraft(transaction)

    assert.notEqual(draft.id, transaction.id)
    assert.match(draft.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })
})
