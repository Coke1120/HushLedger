import { z } from 'zod'
import {
  BANK_CSV_DATE_FORMATS,
  type BankCsvDocument,
  type BankCsvMapping,
} from './bankCsvImport'

export const BANK_CSV_LAYOUTS_STORAGE_KEY = 'hushledger:bank-csv-layouts:v1'
export const MAX_BANK_CSV_LAYOUTS = 8

const MAX_LAYOUT_KEY_LENGTH = 2_048
const columnSchema = z.number().int().nonnegative()
const optionalColumnSchema = columnSchema.nullable()
const baseLayoutSchema = z.object({
  dateColumn: columnSchema,
  dateFormat: z.enum(BANK_CSV_DATE_FORMATS),
  payeeColumn: columnSchema,
  noteColumn: optionalColumnSchema,
  idColumn: optionalColumnSchema,
  flipSign: z.boolean(),
  rememberPayeeCategories: z.boolean(),
})
const bankCsvLayoutSchema = z.discriminatedUnion('amountMode', [
  baseLayoutSchema.extend({
    amountMode: z.literal('signed'),
    amountColumn: columnSchema,
    debitColumn: z.null(),
    creditColumn: z.null(),
  }).strict(),
  baseLayoutSchema.extend({
    amountMode: z.literal('split'),
    amountColumn: z.null(),
    debitColumn: columnSchema,
    creditColumn: columnSchema,
  }).strict(),
])
const storedLayoutSchema = z.object({
  key: z.string().min(1).max(MAX_LAYOUT_KEY_LENGTH),
  mapping: bankCsvLayoutSchema,
}).strict()

export type BankCsvLayout = z.infer<typeof bankCsvLayoutSchema>
export type StoredBankCsvLayout = z.infer<typeof storedLayoutSchema>

export function parseBankCsvLayouts(raw: string | null): StoredBankCsvLayout[] {
  if (!raw) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  const layouts: StoredBankCsvLayout[] = []
  const keys = new Set<string>()
  for (const candidate of parsed) {
    const result = storedLayoutSchema.safeParse(candidate)
    if (!result.success || keys.has(result.data.key)) continue
    keys.add(result.data.key)
    layouts.push(result.data)
    if (layouts.length === MAX_BANK_CSV_LAYOUTS) break
  }
  return layouts
}

export function findBankCsvLayout(
  layouts: readonly StoredBankCsvLayout[],
  document: BankCsvDocument,
): BankCsvLayout | null {
  const key = bankCsvLayoutKey(document)
  if (!key) return null
  const layout = layouts.find((candidate) => candidate.key === key)?.mapping
  return layout && layoutFitsDocument(layout, document) ? layout : null
}

export function rememberBankCsvLayout(
  layouts: readonly StoredBankCsvLayout[],
  document: BankCsvDocument,
  mapping: BankCsvMapping,
): StoredBankCsvLayout[] {
  const key = bankCsvLayoutKey(document)
  if (!key) return [...layouts]
  const candidate = bankCsvLayoutSchema.safeParse(layoutFromMapping(mapping))
  if (!candidate.success || !layoutFitsDocument(candidate.data, document)) return [...layouts]
  return [
    { key, mapping: candidate.data },
    ...layouts.filter((layout) => layout.key !== key),
  ].slice(0, MAX_BANK_CSV_LAYOUTS)
}

export function forgetBankCsvLayout(
  layouts: readonly StoredBankCsvLayout[],
  document: BankCsvDocument,
): StoredBankCsvLayout[] {
  const key = bankCsvLayoutKey(document)
  return key ? layouts.filter((layout) => layout.key !== key) : [...layouts]
}

export function serializeBankCsvLayouts(layouts: readonly StoredBankCsvLayout[]) {
  return JSON.stringify(parseBankCsvLayouts(JSON.stringify(layouts)))
}

export function canRememberBankCsvLayout(document: BankCsvDocument) {
  return bankCsvLayoutKey(document) !== null
}

function bankCsvLayoutKey(document: BankCsvDocument) {
  const key = JSON.stringify([document.delimiter, document.headers])
  return key.length <= MAX_LAYOUT_KEY_LENGTH ? key : null
}

function layoutFromMapping(mapping: BankCsvMapping): BankCsvLayout {
  const base = {
    dateColumn: mapping.dateColumn,
    dateFormat: mapping.dateFormat,
    payeeColumn: mapping.payeeColumn,
    noteColumn: mapping.noteColumn,
    idColumn: mapping.idColumn,
    flipSign: mapping.flipSign,
    rememberPayeeCategories: mapping.rememberPayeeCategories,
  }
  return mapping.amountMode === 'signed'
    ? {
        ...base,
        amountMode: 'signed',
        amountColumn: mapping.amountColumn,
        debitColumn: null,
        creditColumn: null,
      }
    : {
        ...base,
        amountMode: 'split',
        amountColumn: null,
        debitColumn: mapping.debitColumn,
        creditColumn: mapping.creditColumn,
      }
}

function layoutFitsDocument(layout: BankCsvLayout, document: BankCsvDocument) {
  const columns = [
    layout.dateColumn,
    layout.payeeColumn,
    layout.noteColumn,
    layout.idColumn,
    layout.amountColumn,
    layout.debitColumn,
    layout.creditColumn,
  ]
  return layout.dateColumn !== layout.payeeColumn
    && columns.every((column) => column === null || column < document.headers.length)
    && (layout.amountMode !== 'split' || layout.debitColumn !== layout.creditColumn)
}
