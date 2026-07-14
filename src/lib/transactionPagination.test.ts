import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Transaction, TransactionPageCursor } from './schema'
import {
  isValidInitialTransactionPage,
  mergeTransactionContinuation,
  type InitialTransactionPage,
} from './transactionPagination'

function transaction(index: number): Transaction {
  const day = String((index % 28) + 1).padStart(2, '0')
  return {
    id: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    type: 'expense',
    amountMinor: index + 1,
    currency: 'HKD',
    accountId: 1,
    categoryId: 1,
    occurredOn: `2026-07-${day}`,
    cleared: false,
    payee: `Payee ${index}`,
    note: '',
    accountName: 'Checking',
    accountLocalizationKey: null,
    categoryName: 'Food',
    categoryLocalizationKey: null,
    categoryIcon: 'utensils',
    categoryColor: '#123456',
    createdAt: `2026-07-${day}T00:00:00.000Z`,
    updatedAt: `2026-07-${day}T00:00:00.000Z`,
  }
}

function cursorFor(row: Transaction, revision = 9): TransactionPageCursor {
  return {
    version: 1,
    revision,
    queryKey: '{"month":"2026-07","scope":"month","sort":"date_desc"}',
    sort: 'date_desc',
    payeeBlank: 0,
    amountMinor: row.amountMinor,
    occurredOn: row.occurredOn,
    payee: row.payee,
    createdAt: row.createdAt,
    id: row.id,
  }
}

const summary = {
  transactionCount: 205,
  income: 0,
  expense: 21_115,
  net: -21_115,
}

describe('transaction page validation', () => {
  it('accepts a bounded first page and a complete terminal page', () => {
    const first = Array.from({ length: 200 }, (_, index) => transaction(index + 1))
    assert.equal(isValidInitialTransactionPage({
      transactions: first,
      summary,
      nextCursor: cursorFor(first.at(-1)!),
    }), true)
    assert.equal(isValidInitialTransactionPage({
      transactions: first.slice(0, 3),
      summary: { ...summary, transactionCount: 3 },
      nextCursor: null,
    }), true)
  })

  it('rejects duplicate, oversized, partial terminal, and mismatched-cursor first pages', () => {
    const rows = Array.from({ length: 200 }, (_, index) => transaction(index + 1))
    const invalidPages: InitialTransactionPage[] = [
      { transactions: [...rows, transaction(201)], summary, nextCursor: cursorFor(transaction(201)) },
      { transactions: [...rows.slice(0, 199), rows[0]!], summary, nextCursor: cursorFor(rows[0]!) },
      { transactions: rows, summary, nextCursor: cursorFor(rows[198]!) },
      { transactions: rows, summary, nextCursor: { ...cursorFor(rows.at(-1)!), payeeBlank: 1 } },
      {
        transactions: rows,
        summary,
        nextCursor: { ...cursorFor(rows.at(-1)!), queryKey: '' },
      },
      { transactions: rows.slice(0, 5), summary, nextCursor: null },
    ]
    for (const page of invalidPages) assert.equal(isValidInitialTransactionPage(page), false)
  })

  it('merges a final page without duplicate or count drift', () => {
    const current = Array.from({ length: 200 }, (_, index) => transaction(index + 1))
    const page = Array.from({ length: 5 }, (_, index) => transaction(index + 201))
    const result = mergeTransactionContinuation(current, 205, cursorFor(current.at(-1)!), {
      transactions: page,
      nextCursor: null,
    })
    assert.equal(result.kind, 'merged')
    if (result.kind === 'merged') {
      assert.equal(result.transactions.length, 205)
      assert.equal(result.nextCursor, null)
    }
  })

  it('fails closed for stale, duplicate, skipped, or malformed continuations', () => {
    const current = Array.from({ length: 200 }, (_, index) => transaction(index + 1))
    const cursor = cursorFor(current.at(-1)!)
    const next = Array.from({ length: 5 }, (_, index) => transaction(index + 201))
    const invalid = [
      mergeTransactionContinuation(current, 205, { ...cursor, id: current[198]!.id }, {
        transactions: next,
        nextCursor: null,
      }),
      mergeTransactionContinuation(current, 205, cursor, {
        transactions: [current[0]!, ...next.slice(1)],
        nextCursor: null,
      }),
      mergeTransactionContinuation(current, 206, cursor, {
        transactions: next,
        nextCursor: null,
      }),
      mergeTransactionContinuation(current, 405, cursor, {
        transactions: next,
        nextCursor: cursorFor(next.at(-1)!),
      }),
      mergeTransactionContinuation(current, 405, cursor, {
        transactions: Array.from({ length: 200 }, (_, index) => transaction(index + 201)),
        nextCursor: {
          ...cursorFor(transaction(400)),
          payeeBlank: 1,
        },
      }),
    ]
    assert(invalid.every(({ kind }) => kind === 'invalid'))
  })
})
