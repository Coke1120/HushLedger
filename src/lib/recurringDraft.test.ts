import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { recurringRuleDraftFromTransaction } from './recurringDraft'
import type { Transaction } from './schema'

const transaction: Transaction = {
  id: '8be95494-259d-43c4-b047-37cd3d4038b7',
  type: 'expense',
  amountMinor: 4250,
  currency: 'HKD',
  accountId: 1,
  categoryId: 3,
  occurredOn: '2026-01-31',
  cleared: true,
  payee: 'Corner Cafe',
  note: 'Lunch',
  accountName: 'Bank',
  accountLocalizationKey: null,
  categoryName: 'Food',
  categoryLocalizationKey: null,
  categoryIcon: 'utensils',
  categoryColor: '#123456',
  createdAt: '2026-01-31T04:00:00.000Z',
  updatedAt: '2026-01-31T04:00:00.000Z',
  recurringRuleId: null,
  recurringRuleName: null,
}

describe('transaction recurring-rule draft', () => {
  it('copies editable money fields into a reviewable monthly rule starting next occurrence', () => {
    const id = 'c653fe75-e840-4627-aa18-d1c10a827646'

    assert.deepEqual(recurringRuleDraftFromTransaction(transaction, 'Corner Cafe', id), {
      id,
      name: 'Corner Cafe',
      type: 'expense',
      amountMinor: 4250,
      currency: 'HKD',
      accountId: 1,
      categoryId: 3,
      frequency: 'monthly',
      scheduleStartsOn: '2026-01-31',
      firstOccurrenceOn: '2026-02-28',
      isActive: true,
      payee: 'Corner Cafe',
      note: 'Lunch',
    })
  })

  it('uses the category as a safe name fallback and generates a fresh id', () => {
    const draft = recurringRuleDraftFromTransaction(
      { ...transaction, payee: '' },
      '',
    )

    assert.equal(draft.name, 'Food')
    assert.notEqual(draft.id, transaction.id)
    assert.match(draft.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    assert.equal('recurringRuleId' in draft, false)
  })

  it('rejects a transaction that already belongs to a recurring rule', () => {
    assert.throws(
      () => recurringRuleDraftFromTransaction({
        ...transaction,
        recurringRuleId: '27bb3e21-30f7-43c8-b946-f963d584b20a',
      }),
      /cannot seed another recurring rule/,
    )
  })
})
