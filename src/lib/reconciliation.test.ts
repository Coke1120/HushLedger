import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AccountTransfer, Transaction } from './schema'
import {
  calculateReconciliationDifference,
  transactionInputWithClearingStatus,
  transferInputWithClearingStatus,
} from './reconciliation'

const transaction: Transaction = {
  id: '11111111-1111-4111-8111-111111111111',
  type: 'expense',
  amountMinor: 1_250,
  currency: 'HKD',
  accountId: 1,
  categoryId: 2,
  occurredOn: '2026-07-13',
  cleared: false,
  payee: 'Cafe',
  note: 'Lunch',
  accountName: 'Bank',
  accountLocalizationKey: null,
  categoryName: 'Food',
  categoryLocalizationKey: null,
  categoryIcon: 'utensils',
  categoryColor: '#123456',
  createdAt: '2026-07-13T01:00:00.000Z',
  updatedAt: '2026-07-13T01:00:00.000Z',
}

const transfer: AccountTransfer = {
  id: '22222222-2222-4222-8222-222222222222',
  amountMinor: 50_000,
  currency: 'HKD',
  fromAccountId: 1,
  toAccountId: 2,
  occurredOn: '2026-07-13',
  fromCleared: false,
  toCleared: true,
  note: 'Savings',
  fromAccountName: 'Bank',
  fromAccountLocalizationKey: null,
  toAccountName: 'Savings',
  toAccountLocalizationKey: null,
  createdAt: '2026-07-13T01:00:00.000Z',
  updatedAt: '2026-07-13T01:00:00.000Z',
}

describe('reconciliation difference', () => {
  it('subtracts the cleared ledger balance from the statement balance exactly', () => {
    assert.equal(calculateReconciliationDifference(101_750, 103_000), -1_250)
    assert.equal(calculateReconciliationDifference(-50_000, -50_000), 0)
  })

  it('rejects arithmetic outside JavaScript safe-integer precision', () => {
    assert.throws(
      () => calculateReconciliationDifference(Number.MAX_SAFE_INTEGER, -1),
      /safe integer/,
    )
  })

  it('builds a strict transaction input with only the clearing status changed', () => {
    assert.deepEqual(transactionInputWithClearingStatus(transaction, true), {
      id: transaction.id,
      type: 'expense',
      amountMinor: 1_250,
      currency: 'HKD',
      accountId: 1,
      categoryId: 2,
      occurredOn: '2026-07-13',
      cleared: true,
      payee: 'Cafe',
      note: 'Lunch',
    })
  })

  it('changes only the transfer side belonging to the reconciled account', () => {
    assert.deepEqual(transferInputWithClearingStatus(transfer, 1, true), {
      id: transfer.id,
      amountMinor: 50_000,
      currency: 'HKD',
      fromAccountId: 1,
      toAccountId: 2,
      occurredOn: '2026-07-13',
      fromCleared: true,
      toCleared: true,
      note: 'Savings',
    })
    assert.deepEqual(transferInputWithClearingStatus(transfer, 2, false), {
      id: transfer.id,
      amountMinor: 50_000,
      currency: 'HKD',
      fromAccountId: 1,
      toAccountId: 2,
      occurredOn: '2026-07-13',
      fromCleared: false,
      toCleared: false,
      note: 'Savings',
    })
    assert.throws(
      () => transferInputWithClearingStatus(transfer, 3, true),
      /does not belong/,
    )
  })
})
