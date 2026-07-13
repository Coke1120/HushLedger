import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseHushLedgerCsv } from './csvImport'
import { transactionsToCsv } from './transactionCsv'
import type { Account, Category, Transaction } from './schema'

const updatedAt = '2026-07-13T00:00:00.000Z'
const accounts: Account[] = [
  {
    id: 1,
    name: 'Daily, account',
    type: 'bank',
    currency: 'HKD',
    isActive: true,
    sortOrder: 10,
    localizationKey: null,
    updatedAt,
  },
]
const categories: Category[] = [
  {
    id: 3,
    name: 'Food',
    type: 'expense',
    icon: 'utensils',
    color: '#C16B4B',
    isActive: true,
    sortOrder: 10,
    localizationKey: null,
    updatedAt,
  },
]

function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: '10000000-0000-4000-8000-000000000001',
    type: 'expense',
    amountMinor: 1_234,
    currency: 'HKD',
    accountId: 1,
    accountName: 'Daily, account',
    accountLocalizationKey: null,
    categoryId: 3,
    categoryName: 'Food',
    categoryLocalizationKey: null,
    categoryIcon: 'utensils',
    categoryColor: '#C16B4B',
    occurredOn: '2026-07-13',
    cleared: false,
    payee: '=FORMULA()',
    note: 'First line\nSecond line',
    createdAt: updatedAt,
    updatedAt,
    recurringRuleId: null,
    recurringRuleName: null,
    ...overrides,
  }
}

describe('HushLedger CSV import', () => {
  it('round-trips exported rows, quotes, newlines, and spreadsheet-safe text', async () => {
    const csv = transactionsToCsv([transaction()])
    const result = await parseHushLedgerCsv(csv, { accounts, categories })

    assert.deepEqual(result.issues, [])
    assert.equal(result.rows.length, 1)
    assert.deepEqual(result.rows[0], {
      id: '10000000-0000-4000-8000-000000000001',
      type: 'expense',
      amountMinor: 1_234,
      currency: 'HKD',
      accountId: 1,
      categoryId: 3,
      occurredOn: '2026-07-13',
      cleared: false,
      payee: '=FORMULA()',
      note: 'First line\nSecond line',
      sourceRow: 2,
      importKey: 'csv:hushledger:id:10000000-0000-4000-8000-000000000001',
      include: true,
    })
  })

  it('creates stable, distinct fingerprints for identical legacy rows without IDs', async () => {
    const header = 'Date,Type,Amount,Currency,Account,Category,Payee,Note'
    const row = '2026-07-13,expense,-12.34,HKD,"Daily, account",Food,Cafe,'
    const csv = `${header}\r\n${row}\r\n${row}\r\n`
    const first = await parseHushLedgerCsv(csv, { accounts, categories })
    const second = await parseHushLedgerCsv(csv, { accounts, categories })

    assert.deepEqual(first.issues, [])
    assert.equal(first.rows.length, 2)
    assert(first.rows.every(({ cleared }) => cleared))
    assert.notEqual(first.rows[0].importKey, first.rows[1].importKey)
    assert.deepEqual(
      first.rows.map(({ importKey }) => importKey),
      second.rows.map(({ importKey }) => importKey),
    )
  })

  it('reports strict row errors without returning a partial preview', async () => {
    const csv = [
      'Date,Type,Amount,Currency,Account,Category,Payee,Note',
      '2026-02-30,expense,-10.00,HKD,"Daily, account",Food,Cafe,',
      '2026-07-13,expense,10.00,HKD,"Daily, account",Food,Cafe,',
      '2026-07-13,expense,-10.00,HKD,Missing,Food,Cafe,',
    ].join('\r\n')
    const result = await parseHushLedgerCsv(csv, { accounts, categories })

    assert.equal(result.rows.length, 0)
    assert.deepEqual(result.issues.map(({ row, code }) => ({ row, code })), [
      { row: 2, code: 'invalid_date' },
      { row: 3, code: 'invalid_amount' },
      { row: 4, code: 'account_not_found' },
    ])
  })

  it('rejects unknown headers and malformed quoting', async () => {
    const unknown = await parseHushLedgerCsv(
      'Date,Type,Amount,Currency,Account,Category,Payee,Unknown\r\n',
      { accounts, categories },
    )
    assert.equal(unknown.issues[0].code, 'invalid_header')

    const malformed = await parseHushLedgerCsv(
      'Date,Type,Amount,Currency,Account,Category,Payee,Note\r\n"unclosed',
      { accounts, categories },
    )
    assert.equal(malformed.issues[0].code, 'invalid_csv')
  })

  it('rejects an unknown clearing status without returning a partial preview', async () => {
    const result = await parseHushLedgerCsv([
      'Date,Type,Amount,Currency,Account,Category,Payee,Note,Cleared',
      '2026-07-13,expense,-10.00,HKD,"Daily, account",Food,Cafe,,Pending',
    ].join('\r\n'), { accounts, categories })

    assert.equal(result.rows.length, 0)
    assert.deepEqual(result.issues, [{ row: 2, code: 'invalid_clearing_status', value: 'Pending' }])
  })
})
