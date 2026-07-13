import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { BankCsvDocument, BankCsvMapping } from './bankCsvImport'
import {
  findBankCsvLayout,
  forgetBankCsvLayout,
  MAX_BANK_CSV_LAYOUTS,
  parseBankCsvLayouts,
  rememberBankCsvLayout,
  serializeBankCsvLayouts,
} from './bankCsvLayouts'

const document: BankCsvDocument = {
  delimiter: ',',
  headers: ['Date', 'Description', 'Amount'],
  rows: [['13/07/2026', 'Cafe', '-12.50']],
}
const mapping: BankCsvMapping = {
  dateColumn: 0,
  dateFormat: 'dd/mm/yyyy',
  payeeColumn: 1,
  noteColumn: null,
  idColumn: null,
  accountId: 99,
  expenseCategoryId: 98,
  incomeCategoryId: 97,
  flipSign: true,
  rememberPayeeCategories: false,
  amountMode: 'signed',
  amountColumn: 2,
  debitColumn: null,
  creditColumn: null,
}

describe('bank CSV layouts', () => {
  it('remembers only format choices for an exact header layout', () => {
    const layouts = rememberBankCsvLayout([], document, mapping)
    const remembered = findBankCsvLayout(layouts, document)

    assert.deepEqual(remembered, {
      dateColumn: 0,
      dateFormat: 'dd/mm/yyyy',
      payeeColumn: 1,
      noteColumn: null,
      idColumn: null,
      flipSign: true,
      rememberPayeeCategories: false,
      amountMode: 'signed',
      amountColumn: 2,
      debitColumn: null,
      creditColumn: null,
    })
    assert.equal(JSON.stringify(layouts).includes('accountId'), false)
    assert.equal(JSON.stringify(layouts).includes('categoryId'), false)
    assert.equal(JSON.stringify(layouts).includes('Cafe'), false)
    assert.equal(findBankCsvLayout(layouts, { ...document, headers: ['Date', 'Payee', 'Amount'] }), null)
  })

  it('drops malformed storage and layouts with stale column indexes', () => {
    const layouts = rememberBankCsvLayout([], document, mapping)
    assert.deepEqual(parseBankCsvLayouts('{'), [])
    assert.deepEqual(parseBankCsvLayouts(JSON.stringify({ layouts })), [])
    assert.deepEqual(parseBankCsvLayouts(JSON.stringify([{ ...layouts[0], accountId: 99 }])), [])
    assert.deepEqual(parseBankCsvLayouts(JSON.stringify([{
      ...layouts[0],
      mapping: { ...layouts[0].mapping, categoryId: 98 },
    }])), [])
    assert.equal(findBankCsvLayout(layouts, { ...document, headers: ['Date', 'Description'] }), null)
  })

  it('replaces matching layouts, forgets them, and keeps a bounded recent list', () => {
    const updated = rememberBankCsvLayout(
      rememberBankCsvLayout([], document, mapping),
      document,
      { ...mapping, flipSign: false },
    )
    assert.equal(updated.length, 1)
    assert.equal(findBankCsvLayout(updated, document)?.flipSign, false)
    assert.deepEqual(forgetBankCsvLayout(updated, document), [])

    const full = Array.from({ length: MAX_BANK_CSV_LAYOUTS + 2 }, (_, index) => ({
      ...document,
      headers: ['Date', `Description ${index}`, 'Amount'],
    })).reduce(
      (layouts, candidate) => rememberBankCsvLayout(layouts, candidate, mapping),
      [] as ReturnType<typeof rememberBankCsvLayout>,
    )
    assert.equal(full.length, MAX_BANK_CSV_LAYOUTS)
    assert.deepEqual(parseBankCsvLayouts(serializeBankCsvLayouts(full)), full)
  })
})
