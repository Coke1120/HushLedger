import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Account, Category } from './schema'
import {
  detectBankCsvDelimiter,
  mapBankCsvDocument,
  parseBankCsvDocument,
  suggestBankCsvMapping,
  type BankCsvMapping,
} from './bankCsvImport'

const updatedAt = '2026-07-13T00:00:00.000Z'
const accounts: Account[] = [{
  id: 2,
  name: 'Bank',
  type: 'bank',
  currency: 'HKD',
  isActive: true,
  sortOrder: 10,
  localizationKey: null,
  updatedAt,
}]
const categories: Category[] = [
  {
    id: 10,
    name: 'Other expense',
    type: 'expense',
    icon: 'circle-ellipsis',
    color: '#64748B',
    isActive: true,
    sortOrder: 10,
    localizationKey: null,
    monthlyPlanMinor: null,
    updatedAt,
  },
  {
    id: 11,
    name: 'Other income',
    type: 'income',
    icon: 'circle-plus',
    color: '#2F855A',
    isActive: true,
    sortOrder: 10,
    localizationKey: null,
    monthlyPlanMinor: null,
    updatedAt,
  },
]

function baseMapping(overrides: Partial<BankCsvMapping> = {}): BankCsvMapping {
  return {
    dateColumn: 0,
    dateFormat: 'dd/mm/yyyy',
    payeeColumn: 1,
    noteColumn: null,
    idColumn: null,
    accountId: 2,
    expenseCategoryId: 10,
    incomeCategoryId: 11,
    flipSign: false,
    amountMode: 'signed',
    amountColumn: 2,
    debitColumn: null,
    creditColumn: null,
    ...overrides,
  } as BankCsvMapping
}

describe('generic bank CSV import', () => {
  it('detects delimiters and suggests common header and date mappings', () => {
    const text = [
      'Posting Date;Description;Transaction Amount;Reference Number',
      '13/07/2026;Coffee;-45.60;abc-1',
    ].join('\r\n')
    const delimiter = detectBankCsvDelimiter(text)
    const parsed = parseBankCsvDocument(text, delimiter)

    assert.equal(delimiter, ';')
    assert.deepEqual(parsed.issues, [])
    assert(parsed.document)
    assert.deepEqual(suggestBankCsvMapping(parsed.document), {
      dateColumn: 0,
      dateFormat: 'dd/mm/yyyy',
      payeeColumn: 1,
      noteColumn: null,
      idColumn: 3,
      amountMode: 'signed',
      amountColumn: 2,
      debitColumn: null,
      creditColumn: null,
      flipSign: false,
    })
  })

  it('maps signed amounts, exact cents, source IDs, and stable tombstones', async () => {
    const text = [
      'Date,Description,Amount,Reference',
      '13/07/2026,"Cafe, Central","HKD 1,234.50 DR",expense-1',
      '14/07/2026,Salary,"20,000.00 CR",income-1',
    ].join('\r\n')
    const parsed = parseBankCsvDocument(text, ',')
    assert(parsed.document)
    const mapping = baseMapping({ idColumn: 3 })
    const first = await mapBankCsvDocument(parsed.document, mapping, { accounts, categories })
    const second = await mapBankCsvDocument(parsed.document, mapping, { accounts, categories })

    assert.deepEqual(first.issues, [])
    assert(first.rows.every(({ cleared }) => cleared))
    assert.deepEqual(first.rows.map((row) => ({
      type: row.type,
      amountMinor: row.amountMinor,
      categoryId: row.categoryId,
      occurredOn: row.occurredOn,
      payee: row.payee,
    })), [
      { type: 'expense', amountMinor: 123_450, categoryId: 10, occurredOn: '2026-07-13', payee: 'Cafe, Central' },
      { type: 'income', amountMinor: 2_000_000, categoryId: 11, occurredOn: '2026-07-14', payee: 'Salary' },
    ])
    assert.match(first.rows[0].importKey, /^csv:bank:id:[0-9a-f]{64}$/)
    assert.deepEqual(
      first.rows.map((row) => row.importKey),
      second.rows.map((row) => row.importKey),
    )
    assert.notEqual(first.rows[0].id, second.rows[0].id)
  })

  it('supports separate debit and credit columns plus sign flipping', async () => {
    const text = [
      'Transaction Date\tDetails\tWithdrawal\tDeposit',
      '2026-07-13\tCard purchase\t88.20\t',
      '2026-07-14\tRefund\t\t12.30',
    ].join('\n')
    const parsed = parseBankCsvDocument(text, '\t')
    assert(parsed.document)
    const result = await mapBankCsvDocument(parsed.document, {
      ...baseMapping({ dateFormat: 'yyyy-mm-dd', flipSign: true }),
      amountMode: 'split',
      amountColumn: null,
      debitColumn: 2,
      creditColumn: 3,
    }, { accounts, categories })

    assert.deepEqual(result.issues, [])
    assert.deepEqual(result.rows.map((row) => [row.type, row.amountMinor, row.categoryId]), [
      ['income', 8_820, 11],
      ['expense', 1_230, 10],
    ])
  })

  it('rejects ambiguous amounts, duplicate IDs, invalid dates, and partial results', async () => {
    const text = [
      'Date,Description,Debit,Credit,Reference',
      '31/02/2026,Bad date,10,,one',
      '13/07/2026,Both,10,10,two',
      '14/07/2026,First,5,,same',
      '15/07/2026,Second,10,,same',
    ].join('\n')
    const parsed = parseBankCsvDocument(text, ',')
    assert(parsed.document)
    const result = await mapBankCsvDocument(parsed.document, {
      ...baseMapping({ idColumn: 4 }),
      amountMode: 'split',
      amountColumn: null,
      debitColumn: 2,
      creditColumn: 3,
    }, { accounts, categories })

    assert.equal(result.rows.length, 0)
    assert.deepEqual(result.issues.map(({ row, code }) => ({ row, code })), [
      { row: 2, code: 'bank_invalid_date' },
      { row: 3, code: 'bank_amount_conflict' },
      { row: 5, code: 'bank_duplicate_id' },
    ])
  })

  it('rejects duplicate headers and malformed row widths before mapping', () => {
    assert.equal(
      parseBankCsvDocument('Date,Date\n2026-07-13,2026-07-13', ',').issues[0].code,
      'bank_invalid_header',
    )
    assert.deepEqual(
      parseBankCsvDocument('Date,Description,Amount\n2026-07-13,Cafe,-10,extra', ',').issues,
      [{ row: 2, code: 'invalid_column_count' }],
    )
  })
})
