import { isValidCalendarDate } from './date'
import { parseAmount } from './money'
import type { Account, Category, TransactionInput, TransactionType } from './schema'
import {
  MAX_CSV_IMPORT_BYTES,
  MAX_CSV_IMPORT_ROWS,
  csvImportRowSchema,
  parseCsvRecords,
  type CsvImportIssue,
  type CsvImportParseResult,
} from './csvImport'

export const BANK_CSV_DELIMITERS = [',', ';', '\t'] as const
export const BANK_CSV_DATE_FORMATS = [
  'yyyy-mm-dd',
  'dd/mm/yyyy',
  'mm/dd/yyyy',
  'yyyy/mm/dd',
  'dd-mm-yyyy',
] as const

export type BankCsvDelimiter = (typeof BANK_CSV_DELIMITERS)[number]
export type BankCsvDateFormat = (typeof BANK_CSV_DATE_FORMATS)[number]
export type BankCsvAmountMode = 'signed' | 'split'

export type BankCsvDocument = {
  delimiter: BankCsvDelimiter
  headers: string[]
  rows: string[][]
}

type BankCsvBaseMapping = {
  dateColumn: number
  dateFormat: BankCsvDateFormat
  payeeColumn: number
  noteColumn: number | null
  idColumn: number | null
  accountId: number
  expenseCategoryId: number
  incomeCategoryId: number
  flipSign: boolean
}

export type BankCsvMapping = BankCsvBaseMapping & (
  | { amountMode: 'signed'; amountColumn: number; debitColumn: null; creditColumn: null }
  | { amountMode: 'split'; amountColumn: null; debitColumn: number; creditColumn: number }
)

export type BankCsvMappingSuggestion = Partial<BankCsvBaseMapping> & {
  amountMode: BankCsvAmountMode
  amountColumn: number | null
  debitColumn: number | null
  creditColumn: number | null
}

type ReferenceData = {
  accounts: readonly Account[]
  categories: readonly Category[]
}

const headerAliases = {
  date: ['date', 'transaction date', 'posting date', 'posted date', 'value date', '日期', '交易日期', '記帳日期', '取引日', 'date opération'],
  payee: ['description', 'transaction description', 'details', 'merchant', 'payee', 'narrative', '摘要', '描述', '商戶', '備考', 'libellé'],
  note: ['memo', 'note', 'notes', 'remarks', '備註', 'メモ', 'commentaire'],
  id: ['transaction id', 'transaction reference', 'reference number', 'reference no', '流水號', '交易編號', '取引 id'],
  amount: ['amount', 'transaction amount', '金額', '金额', '利用金額', 'montant'],
  debit: ['debit', 'withdrawal', 'money out', 'outflow', '支出', '提款', '引き出し', 'débit'],
  credit: ['credit', 'deposit', 'money in', 'inflow', '收入', '存款', '預け入れ', 'crédit'],
} as const

export function detectBankCsvDelimiter(text: string): BankCsvDelimiter {
  let best: { delimiter: BankCsvDelimiter; score: number } = { delimiter: ',', score: -1 }
  for (const delimiter of BANK_CSV_DELIMITERS) {
    try {
      const records = parseCsvRecords(text, delimiter).slice(0, 12)
      const width = records[0]?.length ?? 0
      const consistent = records.filter((record) => record.length === width).length
      const score = width > 1 ? width * 100 + consistent : 0
      if (score > best.score) best = { delimiter, score }
    } catch {
      // Another delimiter can still parse the document correctly.
    }
  }
  return best.delimiter
}

export function parseBankCsvDocument(
  text: string,
  delimiter: BankCsvDelimiter,
): { document: BankCsvDocument | null; issues: CsvImportIssue[] } {
  if (new TextEncoder().encode(text).byteLength > MAX_CSV_IMPORT_BYTES) {
    return { document: null, issues: [{ row: null, code: 'file_too_large' }] }
  }

  let records: string[][]
  try {
    records = parseCsvRecords(text, delimiter)
  } catch {
    return { document: null, issues: [{ row: null, code: 'invalid_csv' }] }
  }

  while (records.length > 0 && records.at(-1)?.every((field) => field.trim() === '')) records.pop()
  if (records.length < 2 || records[0].every((field) => field.trim() === '')) {
    return { document: null, issues: [{ row: null, code: 'empty_file' }] }
  }

  const headers = records[0].map((header, index) =>
    (index === 0 ? header.replace(/^\uFEFF/, '') : header).trim(),
  )
  const normalizedHeaders = headers.map(normalizeHeader)
  if (
    headers.length < 2 ||
    headers.some((header) => header.length === 0) ||
    new Set(normalizedHeaders).size !== normalizedHeaders.length
  ) {
    return { document: null, issues: [{ row: 1, code: 'bank_invalid_header' }] }
  }

  const rows = records.slice(1).filter((record) => !record.every((field) => field.trim() === ''))
  if (rows.length === 0) return { document: null, issues: [{ row: null, code: 'empty_file' }] }
  if (rows.length > MAX_CSV_IMPORT_ROWS) {
    return { document: null, issues: [{ row: null, code: 'too_many_rows' }] }
  }

  const invalidRow = rows.findIndex((record) => record.length !== headers.length)
  if (invalidRow >= 0) {
    return {
      document: null,
      issues: [{ row: invalidRow + 2, code: 'invalid_column_count' }],
    }
  }

  return { document: { delimiter, headers, rows }, issues: [] }
}

export function suggestBankCsvMapping(document: BankCsvDocument): BankCsvMappingSuggestion {
  const dateColumn = findHeader(document.headers, headerAliases.date)
  const payeeColumn = findHeader(document.headers, headerAliases.payee)
  const noteColumn = findHeader(document.headers, headerAliases.note)
  const idColumn = findHeader(document.headers, headerAliases.id)
  const amountColumn = findHeader(document.headers, headerAliases.amount)
  const debitColumn = findHeader(document.headers, headerAliases.debit)
  const creditColumn = findHeader(document.headers, headerAliases.credit)
  const splitAvailable = debitColumn !== null && creditColumn !== null

  return {
    dateColumn: dateColumn ?? undefined,
    dateFormat: dateColumn === null
      ? 'yyyy-mm-dd'
      : suggestDateFormat(document.rows.map((row) => row[dateColumn])),
    payeeColumn: payeeColumn ?? undefined,
    noteColumn,
    idColumn,
    amountMode: amountColumn === null && splitAvailable ? 'split' : 'signed',
    amountColumn,
    debitColumn,
    creditColumn,
    flipSign: false,
  }
}

export async function mapBankCsvDocument(
  document: BankCsvDocument,
  mapping: BankCsvMapping,
  references: ReferenceData,
): Promise<CsvImportParseResult> {
  const mappingIssue = validateMapping(document, mapping, references)
  if (mappingIssue) return { rows: [], issues: [mappingIssue] }

  const account = references.accounts.find(
    (item) => item.id === mapping.accountId && item.isActive && item.currency === 'HKD',
  )
  const expenseCategory = references.categories.find(
    (item) => item.id === mapping.expenseCategoryId && item.isActive && item.type === 'expense',
  )
  const incomeCategory = references.categories.find(
    (item) => item.id === mapping.incomeCategoryId && item.isActive && item.type === 'income',
  )
  if (!account) return { rows: [], issues: [{ row: null, code: 'account_not_found' }] }
  if (!expenseCategory || !incomeCategory) {
    return { rows: [], issues: [{ row: null, code: 'category_not_found' }] }
  }

  const rows = []
  const issues: CsvImportIssue[] = []
  const occurrences = new Map<string, number>()
  const sourceIds = new Set<string>()

  for (const [index, record] of document.rows.entries()) {
    const sourceRow = index + 2
    const occurredOn = parseBankDate(record[mapping.dateColumn], mapping.dateFormat)
    if (!occurredOn) {
      issues.push({ row: sourceRow, code: 'bank_invalid_date', value: record[mapping.dateColumn] })
      continue
    }

    const signedAmount = amountForRow(record, mapping)
    if (!signedAmount.ok) {
      issues.push({ row: sourceRow, code: signedAmount.code })
      continue
    }
    const type: TransactionType = signedAmount.value < 0 ? 'expense' : 'income'
    const amountMinor = Math.abs(signedAmount.value)
    const payee = record[mapping.payeeColumn].trim()
    const note = mapping.noteColumn === null ? '' : record[mapping.noteColumn].trim()
    if (payee.length > 80) {
      issues.push({ row: sourceRow, code: 'payee_too_long' })
      continue
    }
    if (note.length > 200) {
      issues.push({ row: sourceRow, code: 'note_too_long' })
      continue
    }

    const input: TransactionInput = {
      id: crypto.randomUUID(),
      type,
      amountMinor,
      currency: 'HKD',
      accountId: account.id,
      categoryId: type === 'expense' ? expenseCategory.id : incomeCategory.id,
      occurredOn,
      cleared: true,
      payee,
      note,
    }
    const rawId = mapping.idColumn === null ? '' : record[mapping.idColumn].trim().normalize('NFKC')
    if (rawId && sourceIds.has(rawId)) {
      issues.push({ row: sourceRow, code: 'bank_duplicate_id', value: rawId })
      continue
    }
    if (rawId) sourceIds.add(rawId)

    const importKey = await bankImportKey(input, rawId, occurrences)
    const parsed = csvImportRowSchema.safeParse({ ...input, sourceRow, importKey, include: true })
    if (!parsed.success) {
      issues.push({ row: sourceRow, code: 'invalid_csv' })
      continue
    }
    rows.push(parsed.data)
  }

  return { rows: issues.length > 0 ? [] : rows, issues }
}

function validateMapping(
  document: BankCsvDocument,
  mapping: BankCsvMapping,
  references: ReferenceData,
): CsvImportIssue | null {
  const validColumn = (column: number | null) =>
    column === null || (Number.isInteger(column) && column >= 0 && column < document.headers.length)
  const columns = [
    mapping.dateColumn,
    mapping.payeeColumn,
    mapping.noteColumn,
    mapping.idColumn,
    mapping.amountColumn,
    mapping.debitColumn,
    mapping.creditColumn,
  ]
  if (!columns.every(validColumn)) return { row: null, code: 'bank_mapping_incomplete' }
  if (mapping.dateColumn === mapping.payeeColumn) {
    return { row: null, code: 'bank_mapping_incomplete' }
  }
  if (
    mapping.amountMode === 'signed' && mapping.amountColumn === null ||
    mapping.amountMode === 'split' && (
      mapping.debitColumn === null ||
      mapping.creditColumn === null ||
      mapping.debitColumn === mapping.creditColumn
    )
  ) {
    return { row: null, code: 'bank_mapping_incomplete' }
  }
  if (!references.accounts.some((item) => item.id === mapping.accountId && item.isActive)) {
    return { row: null, code: 'account_not_found' }
  }
  if (!references.categories.some(
    (item) => item.id === mapping.expenseCategoryId && item.isActive && item.type === 'expense',
  ) || !references.categories.some(
    (item) => item.id === mapping.incomeCategoryId && item.isActive && item.type === 'income',
  )) {
    return { row: null, code: 'category_not_found' }
  }
  return null
}

function amountForRow(
  record: readonly string[],
  mapping: BankCsvMapping,
): { ok: true; value: number } | { ok: false; code: 'bank_invalid_amount' | 'bank_amount_conflict' } {
  if (mapping.amountMode === 'signed') {
    const amount = parseBankAmount(record[mapping.amountColumn])
    if (amount === null || amount === 0) return { ok: false, code: 'bank_invalid_amount' }
    return { ok: true, value: mapping.flipSign ? -amount : amount }
  }

  const debit = parseBankAmount(record[mapping.debitColumn], true)
  const credit = parseBankAmount(record[mapping.creditColumn], true)
  if (debit === null || credit === null) return { ok: false, code: 'bank_invalid_amount' }
  if ((debit !== 0 && credit !== 0) || (debit === 0 && credit === 0)) {
    return { ok: false, code: 'bank_amount_conflict' }
  }
  const amount = debit !== 0 ? -Math.abs(debit) : Math.abs(credit)
  return { ok: true, value: mapping.flipSign ? -amount : amount }
}

function parseBankAmount(value: string, emptyIsZero = false) {
  let normalized = value.trim().replaceAll('\u2212', '-')
  if (!normalized) return emptyIsZero ? 0 : null

  let sign = 1
  const parenthesized = normalized.startsWith('(') && normalized.endsWith(')')
  if (parenthesized) {
    sign = -1
    normalized = normalized.slice(1, -1).trim()
  }

  const suffix = normalized.match(/\s+(CR|DR)$/i)?.[1]?.toUpperCase()
  if (suffix) {
    normalized = normalized.replace(/\s+(?:CR|DR)$/i, '').trim()
    sign = suffix === 'DR' ? -1 : 1
  }
  normalized = normalized.replace(/^(?:HKD|HK\$|\$)\s*/i, '')
  if (normalized.startsWith('-') || normalized.startsWith('+')) {
    if (parenthesized || suffix) return null
    sign = normalized.startsWith('-') ? -1 : 1
    normalized = normalized.slice(1)
  }
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(normalized)) return null

  try {
    return sign * parseAmount(normalized.replaceAll(',', ''), 'en')
  } catch {
    return null
  }
}

function parseBankDate(value: string, format: BankCsvDateFormat) {
  const normalized = value.trim()
  let year: string
  let month: string
  let day: string

  if (format === 'yyyy-mm-dd' || format === 'yyyy/mm/dd') {
    const separator = format === 'yyyy-mm-dd' ? '-' : '/'
    const match = normalized.match(new RegExp(`^(\\d{4})${separator}(\\d{1,2})${separator}(\\d{1,2})$`))
    if (!match) return null
    ;[, year, month, day] = match
  } else {
    const separator = format === 'dd-mm-yyyy' ? '-' : '/'
    const match = normalized.match(new RegExp(`^(\\d{1,2})${separator}(\\d{1,2})${separator}(\\d{4})$`))
    if (!match) return null
    if (format === 'mm/dd/yyyy') {
      ;[, month, day, year] = match
    } else {
      ;[, day, month, year] = match
    }
  }

  const result = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  return isValidCalendarDate(result) ? result : null
}

async function bankImportKey(
  input: TransactionInput,
  rawId: string,
  occurrences: Map<string, number>,
) {
  const identity = rawId
    ? JSON.stringify(['bank-id', input.accountId, rawId])
    : JSON.stringify([
      'bank-row',
      input.accountId,
      input.occurredOn,
      input.type,
      input.amountMinor,
      input.payee,
      input.note,
    ])
  const occurrence = rawId ? 1 : (occurrences.get(identity) ?? 0) + 1
  if (!rawId) occurrences.set(identity, occurrence)
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${identity}\u001f${occurrence}`),
  )
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `csv:bank:${rawId ? 'id' : 'row'}:${hex}`
}

function findHeader(headers: readonly string[], aliases: readonly string[]) {
  const normalizedAliases = new Set(aliases.map(normalizeHeader))
  const index = headers.findIndex((header) => normalizedAliases.has(normalizeHeader(header)))
  return index >= 0 ? index : null
}

function normalizeHeader(value: string) {
  return value
    .trim()
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .replace(/[._-]+/g, ' ')
    .replace(/['’]/g, '')
    .replace(/\s+/g, ' ')
}

function suggestDateFormat(values: readonly string[]): BankCsvDateFormat {
  const samples = values.filter((value) => value.trim()).slice(0, 12)
  for (const format of BANK_CSV_DATE_FORMATS) {
    if (samples.length > 0 && samples.every((value) => parseBankDate(value, format))) return format
  }
  return 'yyyy-mm-dd'
}
