import { z } from 'zod'
import { isValidCalendarDate } from './date'

export const LEDGER_BACKUP_FORMAT = 'hushledger-ledger-backup' as const
export const LEDGER_BACKUP_VERSION = 1 as const
export const LEGACY_LEDGER_SCHEMA_VERSION = 8 as const
export const PREVIOUS_LEDGER_SCHEMA_VERSION = 9 as const
export const LEDGER_SCHEMA_VERSION = 10 as const
export const LEDGER_BACKUP_CONFIRMATION = 'RESTORE' as const
export const MAX_LEDGER_BACKUP_FILE_BYTES = 7 * 1024 * 1024
export const MAX_LEDGER_BACKUP_REQUEST_BYTES = 8 * 1024 * 1024
export const LEDGER_RESTORE_CHUNK_BYTES = 512 * 1024
export const MAX_LEDGER_RESTORE_BATCH_STATEMENTS = 40

const safePositiveIntegerSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const safeNonNegativeIntegerSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const timestampSchema = z.string().max(40).datetime({ offset: true })
const calendarDateSchema = z.string().refine(isValidCalendarDate, 'Must be a valid YYYY-MM-DD date')
const uuidSchema = z.string().uuid()
const trimmedNameSchema = z.string().min(1).max(80).refine(
  (value) => value === value.trim(),
  'Must not start or end with whitespace',
)
const accountLocalizationKeySchema = z
  .string()
  .min(3)
  .max(64)
  .regex(/^account\.[a-z_]+$/)
  .nullable()
const categoryLocalizationKeySchema = z
  .string()
  .min(3)
  .max(64)
  .regex(/^category\.[a-z_]+$/)
  .nullable()

export const ledgerBackupAccountSchema = z.object({
  id: safePositiveIntegerSchema,
  name: trimmedNameSchema,
  type: z.enum(['cash', 'bank', 'credit_card', 'wallet']),
  currency: z.literal('HKD'),
  isActive: z.boolean(),
  sortOrder: safeNonNegativeIntegerSchema,
  localizationKey: accountLocalizationKeySchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
}).strict()

const ledgerBackupCategoryFields = {
  id: safePositiveIntegerSchema,
  name: trimmedNameSchema,
  type: z.enum(['expense', 'income']),
  icon: z.string().min(1).max(48).refine((value) => value === value.trim()),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  isActive: z.boolean(),
  sortOrder: safeNonNegativeIntegerSchema,
  localizationKey: categoryLocalizationKeySchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
}

const previousLedgerBackupCategorySchema = z.object(ledgerBackupCategoryFields).strict()

export const ledgerBackupCategorySchema = z.object({
  ...ledgerBackupCategoryFields,
  monthlyPlanMinor: safePositiveIntegerSchema.nullable(),
}).strict().superRefine((category, context) => {
  if (category.type === 'income' && category.monthlyPlanMinor !== null) {
    context.addIssue({
      code: 'custom',
      path: ['monthlyPlanMinor'],
      message: 'Income categories cannot have monthly spending plans',
    })
  }
})

export const ledgerBackupRecurringRuleSchema = z.object({
  id: uuidSchema,
  name: trimmedNameSchema,
  type: z.enum(['expense', 'income']),
  amountMinor: safePositiveIntegerSchema,
  currency: z.literal('HKD'),
  accountId: safePositiveIntegerSchema,
  categoryId: safePositiveIntegerSchema,
  frequency: z.enum(['daily', 'weekly', 'monthly']),
  scheduleStartsOn: calendarDateSchema,
  nextOccurrenceOn: calendarDateSchema,
  lastOccurrenceOn: calendarDateSchema.nullable(),
  anchorDay: z.number().int().min(1).max(31),
  isActive: z.boolean(),
  payee: z.string().max(80),
  note: z.string().max(200),
  generatedCount: safeNonNegativeIntegerSchema,
  lastErrorCode: z.string().min(1).max(64).nullable(),
  lastErrorAt: timestampSchema.nullable(),
  revision: safePositiveIntegerSchema,
  cursorVersion: safePositiveIntegerSchema,
  deletedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
}).strict()

const ledgerBackupTransactionFields = {
  id: uuidSchema,
  type: z.enum(['expense', 'income']),
  amountMinor: safePositiveIntegerSchema,
  currency: z.literal('HKD'),
  accountId: safePositiveIntegerSchema,
  categoryId: safePositiveIntegerSchema,
  occurredOn: calendarDateSchema,
  payee: z.string().max(80),
  note: z.string().max(200),
  recurringRuleId: uuidSchema.nullable(),
  recurringRuleName: z.string().min(1).max(80).nullable(),
  recurrenceDueOn: calendarDateSchema.nullable(),
  recurringOccurrenceKey: z.string().min(1).max(64).nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
}

function validateRecurringTransactionFields(
  row: {
    recurringRuleId: string | null
    recurringRuleName: string | null
    recurrenceDueOn: string | null
    recurringOccurrenceKey: string | null
  },
  context: z.RefinementCtx,
) {
  const recurringFields = [
    row.recurringRuleId,
    row.recurringRuleName,
    row.recurrenceDueOn,
    row.recurringOccurrenceKey,
  ]
  const present = recurringFields.filter((value) => value !== null).length
  if (present !== 0 && present !== recurringFields.length) {
    context.addIssue({
      code: 'custom',
      path: ['recurringRuleId'],
      message: 'Recurring transaction fields must be all present or all null',
    })
  }
  if (
    row.recurringRuleId &&
    row.recurrenceDueOn &&
    row.recurringOccurrenceKey !== `${row.recurringRuleId}:${row.recurrenceDueOn}`
  ) {
    context.addIssue({
      code: 'custom',
      path: ['recurringOccurrenceKey'],
      message: 'Recurring occurrence key does not match its rule and due date',
    })
  }
}

export const ledgerBackupTransactionSchema = z.object({
  ...ledgerBackupTransactionFields,
  cleared: z.boolean(),
}).strict().superRefine(validateRecurringTransactionFields)

const previousLedgerBackupTransactionSchema = z
  .object(ledgerBackupTransactionFields)
  .strict()
  .superRefine(validateRecurringTransactionFields)

export const ledgerBackupImportKeySchema = z.object({
  importKey: z.string().min(20).max(160),
  transactionId: uuidSchema,
  importedAt: timestampSchema,
}).strict()

export const ledgerBackupDataSchema = z.object({
  accounts: z.array(ledgerBackupAccountSchema),
  categories: z.array(ledgerBackupCategorySchema),
  recurringRules: z.array(ledgerBackupRecurringRuleSchema),
  transactions: z.array(ledgerBackupTransactionSchema),
  transactionImportKeys: z.array(ledgerBackupImportKeySchema),
}).strict()

const previousLedgerBackupDataSchema = ledgerBackupDataSchema.extend({
  categories: z.array(previousLedgerBackupCategorySchema),
}).strict()

const legacyLedgerBackupDataSchema = previousLedgerBackupDataSchema.extend({
  transactions: z.array(previousLedgerBackupTransactionSchema),
}).strict()

export const ledgerBackupPayloadSchema = z.object({
  format: z.literal(LEDGER_BACKUP_FORMAT),
  version: z.literal(LEDGER_BACKUP_VERSION),
  exportedAt: timestampSchema,
  schemaVersion: z.literal(LEDGER_SCHEMA_VERSION),
  data: ledgerBackupDataSchema,
}).strict()

export const ledgerBackupSchema = z.object({
  format: z.literal(LEDGER_BACKUP_FORMAT),
  version: z.literal(LEDGER_BACKUP_VERSION),
  exportedAt: timestampSchema,
  schemaVersion: z.literal(LEDGER_SCHEMA_VERSION),
  data: ledgerBackupDataSchema,
  checksum: z.object({
    algorithm: z.literal('SHA-256'),
    digest: z.string().regex(/^[0-9a-f]{64}$/),
  }).strict(),
}).strict()

const previousLedgerBackupPayloadSchema = ledgerBackupPayloadSchema.extend({
  schemaVersion: z.literal(PREVIOUS_LEDGER_SCHEMA_VERSION),
  data: previousLedgerBackupDataSchema,
}).strict()

export const compatibleLedgerBackupPayloadSchema = z.union([
  ledgerBackupPayloadSchema,
  previousLedgerBackupPayloadSchema,
  ledgerBackupPayloadSchema.extend({
    schemaVersion: z.literal(LEGACY_LEDGER_SCHEMA_VERSION),
    data: legacyLedgerBackupDataSchema,
  }).strict(),
])

const previousLedgerBackupSchema = ledgerBackupSchema.extend({
  schemaVersion: z.literal(PREVIOUS_LEDGER_SCHEMA_VERSION),
  data: previousLedgerBackupDataSchema,
}).strict()

export const compatibleLedgerBackupSchema = z.union([
  ledgerBackupSchema,
  previousLedgerBackupSchema,
  ledgerBackupSchema.extend({
    schemaVersion: z.literal(LEGACY_LEDGER_SCHEMA_VERSION),
    data: legacyLedgerBackupDataSchema,
  }).strict(),
])

export const ledgerRestoreRequestSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('preview'),
    backup: compatibleLedgerBackupSchema,
  }).strict(),
  z.object({
    mode: z.literal('commit'),
    backup: compatibleLedgerBackupSchema,
    expectedCurrentDigest: z.string().regex(/^[0-9a-f]{64}$/),
    expectedRevision: safePositiveIntegerSchema,
    confirmation: z.literal(LEDGER_BACKUP_CONFIRMATION),
  }).strict(),
])

export type LedgerBackupAccount = z.infer<typeof ledgerBackupAccountSchema>
export type LedgerBackupCategory = z.infer<typeof ledgerBackupCategorySchema>
export type LedgerBackupRecurringRule = z.infer<typeof ledgerBackupRecurringRuleSchema>
export type LedgerBackupTransaction = z.infer<typeof ledgerBackupTransactionSchema>
export type LedgerBackupImportKey = z.infer<typeof ledgerBackupImportKeySchema>
export type LedgerBackupData = z.infer<typeof ledgerBackupDataSchema>
export type LedgerBackupPayload = z.infer<typeof ledgerBackupPayloadSchema>
export type LedgerBackup = z.infer<typeof ledgerBackupSchema>
export type PreviousLedgerBackupPayload = z.infer<typeof previousLedgerBackupPayloadSchema>
export type CompatibleLedgerBackupPayload = z.infer<typeof compatibleLedgerBackupPayloadSchema>
export type CompatibleLedgerBackup = z.infer<typeof compatibleLedgerBackupSchema>
export type LedgerRestoreRequest = z.infer<typeof ledgerRestoreRequestSchema>

export type LedgerTableCounts = {
  accounts: number
  categories: number
  recurringRules: number
  transactions: number
  transactionImportKeys: number
}

export type LedgerRestorePreview = {
  exportedAt: string
  checksum: string
  backupDigest: string
  currentDigest: string
  currentRevision: number
  currentCounts: LedgerTableCounts
  backupCounts: LedgerTableCounts
  restoreStatements: number
}

export type LedgerRestoreCommitResult = {
  restoredAt: string
  backupDigest: string
  counts: LedgerTableCounts
}

export type LedgerValidationIssue = {
  path: string
  message: string
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`

  const object = value as Record<string, unknown>
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(',')}}`
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function checksumLedgerBackupPayload(
  payload: CompatibleLedgerBackupPayload,
) {
  return sha256Hex(canonicalJson(payload))
}

export function upgradeLedgerBackupData(backup: CompatibleLedgerBackup): LedgerBackupData {
  if (backup.schemaVersion === LEDGER_SCHEMA_VERSION) return backup.data
  return ledgerBackupDataSchema.parse({
    ...backup.data,
    categories: backup.data.categories.map((category) => ({
      ...category,
      monthlyPlanMinor: null,
    })),
    transactions: backup.schemaVersion === LEGACY_LEDGER_SCHEMA_VERSION
      ? backup.data.transactions.map((transaction) => ({ ...transaction, cleared: true }))
      : backup.data.transactions,
  })
}

export async function digestLedgerData(data: LedgerBackupData) {
  return sha256Hex(canonicalJson(data))
}

export function countLedgerData(data: LedgerBackupData): LedgerTableCounts {
  return {
    accounts: data.accounts.length,
    categories: data.categories.length,
    recurringRules: data.recurringRules.length,
    transactions: data.transactions.length,
    transactionImportKeys: data.transactionImportKeys.length,
  }
}

export function validateLedgerDataRelations(data: LedgerBackupData): LedgerValidationIssue[] {
  const issues: LedgerValidationIssue[] = []
  const accounts = new Map(data.accounts.map((account) => [account.id, account]))
  const categories = new Map(data.categories.map((category) => [category.id, category]))
  const rules = new Map(data.recurringRules.map((rule) => [rule.id, rule]))

  collectDuplicateIssues(data.accounts, (row) => String(row.id), 'accounts', 'id', issues)
  collectDuplicateIssues(data.accounts, (row) => row.name.toLowerCase(), 'accounts', 'name', issues)
  collectDuplicateIssues(
    data.accounts.filter((row) => row.localizationKey !== null),
    (row) => row.localizationKey ?? '',
    'accounts',
    'localizationKey',
    issues,
  )
  collectDuplicateIssues(data.categories, (row) => String(row.id), 'categories', 'id', issues)
  collectDuplicateIssues(
    data.categories,
    (row) => `${row.type}:${row.name.toLowerCase()}`,
    'categories',
    'name',
    issues,
  )
  collectDuplicateIssues(
    data.categories.filter((row) => row.localizationKey !== null),
    (row) => row.localizationKey ?? '',
    'categories',
    'localizationKey',
    issues,
  )
  collectDuplicateIssues(data.recurringRules, (row) => row.id, 'recurringRules', 'id', issues)
  collectDuplicateIssues(data.transactions, (row) => row.id, 'transactions', 'id', issues)
  collectDuplicateIssues(
    data.transactions.filter((row) => row.recurringOccurrenceKey !== null),
    (row) => row.recurringOccurrenceKey ?? '',
    'transactions',
    'recurringOccurrenceKey',
    issues,
  )
  collectDuplicateIssues(
    data.transactionImportKeys,
    (row) => row.importKey,
    'transactionImportKeys',
    'importKey',
    issues,
  )

  if (!data.accounts.some((account) => account.isActive)) {
    issues.push({ path: 'data.accounts', message: 'At least one active account is required' })
  }
  for (const type of ['expense', 'income'] as const) {
    if (!data.categories.some((category) => category.isActive && category.type === type)) {
      issues.push({
        path: 'data.categories',
        message: `At least one active ${type} category is required`,
      })
    }
  }

  data.recurringRules.forEach((rule, index) => {
    validateReferencePair(rule, `data.recurringRules.${index}`, accounts, categories, issues)
    if (rule.nextOccurrenceOn < rule.scheduleStartsOn) {
      issues.push({
        path: `data.recurringRules.${index}.nextOccurrenceOn`,
        message: 'Next occurrence cannot be before the schedule start',
      })
    }
    if (rule.lastOccurrenceOn && rule.lastOccurrenceOn >= rule.nextOccurrenceOn) {
      issues.push({
        path: `data.recurringRules.${index}.lastOccurrenceOn`,
        message: 'Last occurrence must be before the next occurrence',
      })
    }
  })

  data.transactions.forEach((transaction, index) => {
    validateReferencePair(transaction, `data.transactions.${index}`, accounts, categories, issues)
    if (transaction.recurringRuleId && !rules.has(transaction.recurringRuleId)) {
      issues.push({
        path: `data.transactions.${index}.recurringRuleId`,
        message: 'Referenced recurring rule is missing',
      })
    }
  })

  return issues
}

function collectDuplicateIssues<T>(
  rows: readonly T[],
  keyFor: (row: T) => string,
  collection: string,
  field: string,
  issues: LedgerValidationIssue[],
) {
  const firstIndex = new Map<string, number>()
  rows.forEach((row, index) => {
    const key = keyFor(row)
    const existing = firstIndex.get(key)
    if (existing === undefined) {
      firstIndex.set(key, index)
      return
    }
    issues.push({
      path: `data.${collection}.${index}.${field}`,
      message: `Duplicates data.${collection}.${existing}.${field}`,
    })
  })
}

function validateReferencePair(
  row: { accountId: number; categoryId: number; currency: 'HKD'; type: 'expense' | 'income' },
  path: string,
  accounts: Map<number, LedgerBackupAccount>,
  categories: Map<number, LedgerBackupCategory>,
  issues: LedgerValidationIssue[],
) {
  const account = accounts.get(row.accountId)
  if (!account) {
    issues.push({ path: `${path}.accountId`, message: 'Referenced account is missing' })
  } else if (account.currency !== row.currency) {
    issues.push({ path: `${path}.currency`, message: 'Currency does not match the account' })
  }

  const category = categories.get(row.categoryId)
  if (!category) {
    issues.push({ path: `${path}.categoryId`, message: 'Referenced category is missing' })
  } else if (category.type !== row.type) {
    issues.push({ path: `${path}.categoryId`, message: 'Category type does not match the row type' })
  }
}
