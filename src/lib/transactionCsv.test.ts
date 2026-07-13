import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { transactionsToCsv, type CsvTransaction } from './transactionCsv'

const transaction: CsvTransaction = {
  id: '10000000-0000-4000-8000-000000000001',
  type: 'expense',
  amountMinor: 12_345,
  currency: 'HKD',
  occurredOn: '2026-07-13',
  cleared: false,
  accountName: '銀行戶口',
  categoryName: '飲食',
  payee: 'Coffee, "Central"',
  note: 'First line\nSecond line',
  recurringRuleName: null,
  recurrenceDueOn: null,
}

describe('transaction CSV export', () => {
  it('exports exact signed decimal amounts and UTF-8 spreadsheet text', () => {
    const csv = transactionsToCsv([
      transaction,
      { ...transaction, type: 'income', amountMinor: 5, payee: 'Salary' },
    ])

    assert(csv.startsWith('\uFEFFDate,Type,Amount,Currency'))
    assert.match(csv, /,Uncleared,/)
    assert.match(csv, /2026-07-13,expense,-123\.45,HKD/)
    assert.match(csv, /2026-07-13,income,0\.05,HKD/)
    assert.match(csv, /"Coffee, ""Central"""/)
    assert.match(csv, /"First line\nSecond line"/)
    assert.match(csv, /10000000-0000-4000-8000-000000000001/)
    assert(csv.endsWith('\r\n'))
  })

  it('neutralizes user-controlled spreadsheet formulas', () => {
    const csv = transactionsToCsv([{
      ...transaction,
      accountName: '=ACCOUNT()',
      categoryName: ' +CATEGORY()',
      payee: '@PAYEE()',
      note: '-10+20',
      recurringRuleName: '\n=RULE()',
    }])

    assert.match(csv, /"'=ACCOUNT\(\)"/)
    assert.match(csv, /"' \+CATEGORY\(\)"/)
    assert.match(csv, /"'@PAYEE\(\)"/)
    assert.match(csv, /"'-10\+20"/)
    assert.match(csv, /"'\n=RULE\(\)"/)
  })
})
