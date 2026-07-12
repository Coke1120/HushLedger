import { z } from 'zod'
import { isValidCalendarDate } from './date'
import { parseAmount } from './money'
import {
  transactionIdSchema,
  transactionInputSchema,
  transactionTypeSchema,
  type Account,
  type Category,
  type TransactionInput,
  type TransactionType,
} from './schema'

export const MAX_CSV_IMPORT_BYTES = 512 * 1024
export const MAX_CSV_IMPORT_ROWS = 200
export const MAX_CSV_IMPORT_REQUEST_BYTES = 256 * 1024

export const CSV_IMPORT_HEADERS = [
  'Date',
  'Type',
  'Amount',
  'Currency',
  'Account',
  'Category',
  'Payee',
  'Note',
  'Recurring Rule',
  'Recurring Due Date',
  'Transaction ID',
] as const

const requiredHeaders = CSV_IMPORT_HEADERS.slice(0, 8)
const allowedHeaders = new Set<string>(CSV_IMPORT_HEADERS)
const importKeySchema = z
  .string()
  .min(20)
  .max(160)
  .regex(/^csv:hushledger:(?:id:[0-9a-f-]{36}|row:[0-9a-f]{64})$/)

export const csvImportRowSchema = transactionInputSchema
  .extend({
    sourceRow: z.number().int().min(2).max(MAX_CSV_IMPORT_ROWS + 1),
    importKey: importKeySchema,
    include: z.boolean(),
  })
  .strict()

export const csvImportRequestSchema = z
  .object({
    mode: z.enum(['preview', 'commit']),
    rows: z.array(csvImportRowSchema).min(1).max(MAX_CSV_IMPORT_ROWS),
  })
  .strict()

export const csvImportRowStatusSchema = z.enum([
  'new',
  'possible_duplicate',
  'already_imported',
  'existing_transaction',
  'id_conflict',
  'account_invalid',
  'category_invalid',
  'category_mismatch',
])

export const csvImportPreviewRowSchema = z
  .object({
    sourceRow: z.number().int().positive(),
    importKey: importKeySchema,
    status: csvImportRowStatusSchema,
  })
  .strict()

export const csvImportPreviewResultSchema = z
  .object({
    rows: z.array(csvImportPreviewRowSchema).max(MAX_CSV_IMPORT_ROWS),
    ready: z.number().int().nonnegative(),
    possibleDuplicates: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    blocked: z.number().int().nonnegative(),
  })
  .strict()

export const csvImportCommitResultSchema = csvImportPreviewResultSchema
  .extend({
    imported: z.number().int().nonnegative(),
    staleSkipped: z.number().int().nonnegative(),
  })
  .strict()

export type CsvImportRow = z.infer<typeof csvImportRowSchema>
export type CsvImportRowStatus = z.infer<typeof csvImportRowStatusSchema>
export type CsvImportPreviewRow = z.infer<typeof csvImportPreviewRowSchema>
export type CsvImportPreviewResult = z.infer<typeof csvImportPreviewResultSchema>
export type CsvImportCommitResult = z.infer<typeof csvImportCommitResultSchema>

export type CsvImportIssueCode =
  | 'empty_file'
  | 'file_too_large'
  | 'invalid_csv'
  | 'invalid_header'
  | 'too_many_rows'
  | 'invalid_column_count'
  | 'invalid_date'
  | 'invalid_type'
  | 'invalid_amount'
  | 'invalid_currency'
  | 'account_not_found'
  | 'account_ambiguous'
  | 'category_not_found'
  | 'category_ambiguous'
  | 'payee_too_long'
  | 'note_too_long'
  | 'invalid_transaction_id'

export type CsvImportIssue = {
  row: number | null
  code: CsvImportIssueCode
  value?: string
}

export type CsvImportParseResult = {
  rows: CsvImportRow[]
  issues: CsvImportIssue[]
}

type ReferenceData = {
  accounts: readonly Account[]
  categories: readonly Category[]
}

export async function parseHushLedgerCsv(
  text: string,
  references: ReferenceData,
): Promise<CsvImportParseResult> {
  if (new TextEncoder().encode(text).byteLength > MAX_CSV_IMPORT_BYTES) {
    return { rows: [], issues: [{ row: null, code: 'file_too_large' }] }
  }

  let records: string[][]
  try {
    records = parseCsvRecords(text)
  } catch {
    return { rows: [], issues: [{ row: null, code: 'invalid_csv' }] }
  }

  while (records.length > 0 && records.at(-1)?.every((field) => field === '')) records.pop()
  if (records.length === 0 || records[0].every((field) => field.trim() === '')) {
    return { rows: [], issues: [{ row: null, code: 'empty_file' }] }
  }

  const headers = records[0].map((header, index) =>
    (index === 0 ? header.replace(/^\uFEFF/, '') : header).trim(),
  )
  const headerSet = new Set(headers)
  const headerValid =
    headers.length === headerSet.size &&
    headers.every((header) => allowedHeaders.has(header)) &&
    requiredHeaders.every((header) => headerSet.has(header))
  if (!headerValid) {
    return { rows: [], issues: [{ row: 1, code: 'invalid_header' }] }
  }

  const dataRecords = records.slice(1).filter((record) => !record.every((field) => field === ''))
  if (dataRecords.length === 0) return { rows: [], issues: [{ row: null, code: 'empty_file' }] }
  if (dataRecords.length > MAX_CSV_IMPORT_ROWS) {
    return { rows: [], issues: [{ row: null, code: 'too_many_rows' }] }
  }

  const headerIndex = new Map(headers.map((header, index) => [header, index]))
  const issues: CsvImportIssue[] = []
  const rows: CsvImportRow[] = []
  const legacyOccurrences = new Map<string, number>()

  for (const [index, record] of dataRecords.entries()) {
    const sourceRow = index + 2
    if (record.length !== headers.length) {
      issues.push({ row: sourceRow, code: 'invalid_column_count' })
      continue
    }

    const value = (header: string) => record[headerIndex.get(header) ?? -1] ?? ''
    const occurredOn = value('Date').trim()
    if (!isValidCalendarDate(occurredOn)) {
      issues.push({ row: sourceRow, code: 'invalid_date', value: occurredOn })
      continue
    }

    const parsedType = transactionTypeSchema.safeParse(value('Type').trim().toLowerCase())
    if (!parsedType.success) {
      issues.push({ row: sourceRow, code: 'invalid_type', value: value('Type').trim() })
      continue
    }
    const type = parsedType.data

    const amountMinor = parseCsvAmount(value('Amount'), type)
    if (amountMinor === null) {
      issues.push({ row: sourceRow, code: 'invalid_amount', value: value('Amount').trim() })
      continue
    }

    const currency = value('Currency').trim().toUpperCase()
    if (currency !== 'HKD') {
      issues.push({ row: sourceRow, code: 'invalid_currency', value: currency })
      continue
    }

    const accountName = value('Account').trim()
    const matchingAccounts = references.accounts.filter(
      (account) => normalizedName(account.name) === normalizedName(accountName),
    )
    if (matchingAccounts.length === 0) {
      issues.push({ row: sourceRow, code: 'account_not_found', value: accountName })
      continue
    }
    if (matchingAccounts.length > 1) {
      issues.push({ row: sourceRow, code: 'account_ambiguous', value: accountName })
      continue
    }

    const categoryName = value('Category').trim()
    const matchingCategories = references.categories.filter(
      (category) =>
        category.type === type && normalizedName(category.name) === normalizedName(categoryName),
    )
    if (matchingCategories.length === 0) {
      issues.push({ row: sourceRow, code: 'category_not_found', value: categoryName })
      continue
    }
    if (matchingCategories.length > 1) {
      issues.push({ row: sourceRow, code: 'category_ambiguous', value: categoryName })
      continue
    }

    const payee = restoreSpreadsheetText(value('Payee')).trim()
    const note = restoreSpreadsheetText(value('Note')).trim()
    if (payee.length > 80) {
      issues.push({ row: sourceRow, code: 'payee_too_long' })
      continue
    }
    if (note.length > 200) {
      issues.push({ row: sourceRow, code: 'note_too_long' })
      continue
    }

    const sourceId = value('Transaction ID').trim().toLowerCase()
    if (sourceId && !transactionIdSchema.safeParse(sourceId).success) {
      issues.push({ row: sourceRow, code: 'invalid_transaction_id', value: sourceId })
      continue
    }

    const input: TransactionInput = {
      id: sourceId || crypto.randomUUID(),
      type,
      amountMinor,
      currency: 'HKD',
      accountId: matchingAccounts[0].id,
      categoryId: matchingCategories[0].id,
      occurredOn,
      payee,
      note,
    }
    const importKey = sourceId
      ? `csv:hushledger:id:${sourceId}`
      : await legacyImportKey(input, accountName, categoryName, legacyOccurrences)
    const parsedRow = csvImportRowSchema.safeParse({ ...input, sourceRow, importKey, include: true })
    if (!parsedRow.success) {
      issues.push({ row: sourceRow, code: 'invalid_csv' })
      continue
    }
    rows.push(parsedRow.data)
  }

  return { rows: issues.length > 0 ? [] : rows, issues }
}

function parseCsvAmount(value: string, type: TransactionType) {
  const trimmed = value.trim()
  const negative = trimmed.startsWith('-')
  const unsigned = trimmed.startsWith('-') || trimmed.startsWith('+') ? trimmed.slice(1) : trimmed
  if ((type === 'expense' && !negative) || (type === 'income' && negative)) return null
  try {
    return parseAmount(unsigned, 'en')
  } catch {
    return null
  }
}

async function legacyImportKey(
  input: TransactionInput,
  accountName: string,
  categoryName: string,
  occurrences: Map<string, number>,
) {
  const canonical = JSON.stringify([
    input.occurredOn,
    input.type,
    input.amountMinor,
    input.currency,
    normalizedName(accountName),
    normalizedName(categoryName),
    input.payee,
    input.note,
  ])
  const occurrence = (occurrences.get(canonical) ?? 0) + 1
  occurrences.set(canonical, occurrence)
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${canonical}\u001f${occurrence}`),
  )
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `csv:hushledger:row:${hex}`
}

function normalizedName(value: string) {
  return value.trim().normalize('NFKC').toLocaleLowerCase('en')
}

function restoreSpreadsheetText(value: string) {
  if (!value.startsWith("'")) return value
  const restored = value.slice(1)
  return /^(?:[\t\r\n]|[ \t\r\n]*[=+\-@])/.test(restored) ? restored : value
}

function parseCsvRecords(text: string) {
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let quoted = false
  let closedQuote = false

  const pushField = () => {
    record.push(field)
    field = ''
    closedQuote = false
  }
  const pushRecord = () => {
    pushField()
    records.push(record)
    record = []
  }

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          quoted = false
          closedQuote = true
        }
      } else {
        field += character
      }
      continue
    }

    if (closedQuote && character !== ',' && character !== '\r' && character !== '\n') {
      throw new Error('Unexpected text after a closing quote')
    }
    if (character === '"') {
      if (field.length > 0 || closedQuote) throw new Error('Unexpected quote')
      quoted = true
    } else if (character === ',') {
      pushField()
    } else if (character === '\r' || character === '\n') {
      if (character === '\r' && text[index + 1] === '\n') index += 1
      pushRecord()
    } else {
      field += character
    }
  }

  if (quoted) throw new Error('Unclosed quoted field')
  if (field.length > 0 || record.length > 0 || closedQuote) pushRecord()
  return records
}
