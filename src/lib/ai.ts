import { z } from 'zod'
import { supportedCurrencySchema } from './currency'
import { isValidCalendarDate } from './date'
import { exactTransactionTotals } from './money'
import { calculateReconciliationDifference } from './reconciliation'
import { transactionTypeSchema } from './schema'
import {
  MAX_TRANSACTION_IMPORT_ROWS,
  transactionImportKeySchema,
  transactionImportRowSchema,
  type TransactionImportPreviewResult,
} from './transactionImport'

export const MAX_AI_STATEMENT_BYTES = 64 * 1024
export const MAX_AI_PARSE_REQUEST_BYTES = 512 * 1024
export const MAX_AI_MODELS_REQUEST_BYTES = 8 * 1024
export const MAX_AI_MODELS_RESPONSE_BYTES = 64 * 1024
export const MAX_AI_COMPLETION_RESPONSE_BYTES = 256 * 1024
export const MAX_AI_DRAFT_ROWS = 200
export const MAX_AI_IMPORT_REQUEST_BYTES = 256 * 1024

export const AI_POSITIVE_DECIMAL_PATTERN =
  '^(?:0\\.(?:0[1-9]|[1-9]\\d?)|[1-9]\\d*(?:\\.\\d{1,2})?)$'
export const AI_NON_NEGATIVE_DECIMAL_PATTERN =
  '^(?:0|[1-9]\\d*)(?:\\.\\d{1,2})?$'
export const AI_SIGNED_DECIMAL_PATTERN =
  '^(?:0(?:\\.\\d{1,2})?|[1-9]\\d*(?:\\.\\d{1,2})?|-(?:0\\.(?:0[1-9]|[1-9]\\d?)|[1-9]\\d*(?:\\.\\d{1,2})?))$'

const boundedText = (maximum: number) => z.string().trim().min(1).max(maximum)
const apiKeySchema = boundedText(2_048).regex(
  /^[\x21-\x7e]+$/,
  'API key must contain only printable ASCII characters without spaces',
)

export const aiProviderConnectionSchema = z
  .object({
    baseUrl: boundedText(2_048),
    apiKey: apiKeySchema,
  })
  .strict()

export const aiProviderSettingsSchema = aiProviderConnectionSchema
  .extend({ model: boundedText(200) })
  .strict()

export const aiProviderSettingsWriteSchema = z
  .object({
    baseUrl: boundedText(2_048),
    model: boundedText(200),
    apiKey: apiKeySchema.optional(),
  })
  .strict()

export const aiProviderSettingsMetadataSchema = z
  .object({
    baseUrl: boundedText(2_048),
    model: boundedText(200),
    hasApiKey: z.literal(true),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict()

export const aiModelsProviderSourceSchema = z.discriminatedUnion('source', [
  aiProviderConnectionSchema.extend({ source: z.literal('transient') }).strict(),
  z
    .object({
      source: z.literal('stored'),
      expectedUpdatedAt: z.string().datetime({ offset: true }),
    })
    .strict(),
])

export const aiParseProviderSourceSchema = z.discriminatedUnion('source', [
  aiProviderSettingsSchema.extend({ source: z.literal('transient') }).strict(),
  z
    .object({
      source: z.literal('stored'),
      expectedUpdatedAt: z.string().datetime({ offset: true }),
    })
    .strict(),
])

export const aiModelsRequestSchema = z
  .object({ provider: aiModelsProviderSourceSchema })
  .strict()

export const aiDateOrderSchema = z.enum(['DMY', 'MDY', 'YMD'])

export const aiParseRequestSchema = z
  .object({
    provider: aiParseProviderSourceSchema,
    accountId: z.number().int().positive(),
    currency: supportedCurrencySchema,
    dateOrder: aiDateOrderSchema,
    statementText: z.string().trim().min(1).max(MAX_AI_STATEMENT_BYTES),
  })
  .strict()

const aiModelDraftFlagSchema = z.enum([
  'UNCERTAIN_DATE',
  'UNCERTAIN_AMOUNT',
  'UNCERTAIN_DIRECTION',
  'UNCERTAIN_CATEGORY',
  'POSSIBLE_DUPLICATE',
  'POSSIBLE_TRANSFER',
  'NEEDS_REVIEW',
])

export const aiDraftFlagSchema = z.enum([
  ...aiModelDraftFlagSchema.options,
  'RUNNING_BALANCE_MISMATCH',
])

const aiStatementBalanceSchema = z
  .object({
    sourceLine: z.number().int().positive(),
    amountText: boundedText(32).regex(new RegExp(AI_SIGNED_DECIMAL_PATTERN)),
  })
  .strict()

const aiStatementTotalSchema = z
  .object({
    sourceLine: z.number().int().positive(),
    amountText: boundedText(32).regex(new RegExp(AI_NON_NEGATIVE_DECIMAL_PATTERN)),
  })
  .strict()

const aiStatementReferenceSchema = z
  .object({
    sourceLine: z.number().int().positive(),
    referenceText: boundedText(80),
  })
  .strict()

export const aiModelOutputSchema = z
  .object({
    openingBalance: aiStatementBalanceSchema.nullable(),
    closingBalance: aiStatementBalanceSchema.nullable(),
    debitTotal: aiStatementTotalSchema.nullable(),
    creditTotal: aiStatementTotalSchema.nullable(),
    rows: z
      .array(
        z
          .object({
            sourceLine: z.number().int().positive(),
            occurredOn: z.string().refine(isValidCalendarDate),
            direction: transactionTypeSchema,
            amountText: boundedText(32).regex(new RegExp(AI_POSITIVE_DECIMAL_PATTERN)),
            currency: supportedCurrencySchema,
            description: z.string().trim().max(80),
            reference: aiStatementReferenceSchema.nullable(),
            runningBalance: aiStatementBalanceSchema.nullable(),
            suggestedCategoryName: z.string().trim().min(1).max(80).nullable(),
            confidence: z.number().min(0).max(1),
            flags: z.array(aiModelDraftFlagSchema).max(8),
          })
          .strict(),
      )
      .max(MAX_AI_DRAFT_ROWS),
  })
  .strict()

export const bankStatementSourceAmountSchema = z
  .object({
    sourceLine: z.number().int().positive(),
    sourceText: z.string().max(240),
    amountText: boundedText(32),
    amountMinor: z
      .number()
      .int()
      .min(Number.MIN_SAFE_INTEGER)
      .max(Number.MAX_SAFE_INTEGER),
  })
  .strict()

export type BankStatementSourceAmount = z.infer<typeof bankStatementSourceAmountSchema>

export const bankImportDraftSchema = z
  .object({
    id: z.string().uuid(),
    importKey: transactionImportKeySchema.refine(
      (value) => /^ai:statement:row:[0-9a-f]{64}$/.test(value),
    ),
    sourceLine: z.number().int().positive(),
    sourceText: z.string().max(240),
    bankReference: z.string().min(6).max(80).nullable(),
    runningBalance: bankStatementSourceAmountSchema.nullable(),
    occurredOn: z.string().refine(isValidCalendarDate),
    type: transactionTypeSchema,
    amountText: boundedText(32),
    amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    currency: supportedCurrencySchema,
    accountId: z.number().int().positive(),
    categoryId: z.number().int().positive().nullable(),
    payee: z.string().trim().max(80),
    confidence: z.number().min(0).max(1),
    flags: z.array(aiDraftFlagSchema).max(9),
  })
  .strict()

export const bankImportDraftsSchema = z.array(bankImportDraftSchema).max(MAX_AI_DRAFT_ROWS)

export const bankStatementVerificationSchema = z
  .object({
    status: z.enum(['matched', 'mismatch', 'unavailable']),
    openingBalance: bankStatementSourceAmountSchema.nullable(),
    closingBalance: bankStatementSourceAmountSchema.nullable(),
    debitTotal: bankStatementSourceAmountSchema.nullable(),
    creditTotal: bankStatementSourceAmountSchema.nullable(),
    parsedIncomeMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    parsedExpenseMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    parsedNetMinor: z
      .number()
      .int()
      .min(Number.MIN_SAFE_INTEGER)
      .max(Number.MAX_SAFE_INTEGER),
    balanceDifferenceMinor: z
      .number()
      .int()
      .min(Number.MIN_SAFE_INTEGER)
      .max(Number.MAX_SAFE_INTEGER)
      .nullable(),
    debitDifferenceMinor: z
      .number()
      .int()
      .min(Number.MIN_SAFE_INTEGER)
      .max(Number.MAX_SAFE_INTEGER)
      .nullable(),
    creditDifferenceMinor: z
      .number()
      .int()
      .min(Number.MIN_SAFE_INTEGER)
      .max(Number.MAX_SAFE_INTEGER)
      .nullable(),
    runningBalanceStatus: z.enum(['matched', 'mismatch', 'unavailable']),
    runningBalanceCheckedRows: z.number().int().min(0).max(MAX_AI_DRAFT_ROWS),
    runningBalanceMismatchSourceLines: z
      .array(z.number().int().positive())
      .max(MAX_AI_DRAFT_ROWS),
  })
  .strict()

export type BankStatementVerification = z.infer<typeof bankStatementVerificationSchema>
export type BankStatementVerificationEvidence = Pick<
  BankStatementVerification,
  'openingBalance' | 'closingBalance' | 'debitTotal' | 'creditTotal'
>

export const bankStatementParseResultSchema = z
  .object({
    drafts: bankImportDraftsSchema,
    verification: bankStatementVerificationSchema,
  })
  .strict()

export type BankStatementParseResult = z.infer<typeof bankStatementParseResultSchema>

export function calculateBankStatementVerification(
  evidence: BankStatementVerificationEvidence,
  entries: readonly {
    type: 'income' | 'expense'
    amountMinor: number
    sourceLine?: number
    occurredOn?: string
    runningBalance?: BankStatementSourceAmount | null
  }[],
): BankStatementVerification {
  const parsed = exactTransactionTotals(entries)
  const runningBalance = calculateRunningBalanceVerification(entries)
  const balanceDifferenceMinor = evidence.openingBalance && evidence.closingBalance
    ? calculateReconciliationDifference(
        evidence.closingBalance.amountMinor,
        evidence.openingBalance.amountMinor + parsed.net,
      )
    : null
  const debitDifferenceMinor = evidence.debitTotal
    ? calculateReconciliationDifference(evidence.debitTotal.amountMinor, parsed.expense)
    : null
  const creditDifferenceMinor = evidence.creditTotal
    ? calculateReconciliationDifference(evidence.creditTotal.amountMinor, parsed.income)
    : null
  const differences = [
    balanceDifferenceMinor,
    debitDifferenceMinor,
    creditDifferenceMinor,
  ].filter((difference): difference is number => difference !== null)
  const hasFullCoverage = balanceDifferenceMinor !== null
    || (debitDifferenceMinor !== null && creditDifferenceMinor !== null)
  const status = differences.some((difference) => difference !== 0)
    ? 'mismatch'
    : hasFullCoverage ? 'matched' : 'unavailable'

  return {
    ...evidence,
    status,
    parsedIncomeMinor: parsed.income,
    parsedExpenseMinor: parsed.expense,
    parsedNetMinor: parsed.net,
    balanceDifferenceMinor,
    debitDifferenceMinor,
    creditDifferenceMinor,
    runningBalanceStatus: runningBalance.status,
    runningBalanceCheckedRows: runningBalance.checkedRows,
    runningBalanceMismatchSourceLines: runningBalance.mismatchSourceLines,
  }
}

function calculateRunningBalanceVerification(
  entries: readonly {
    type: 'income' | 'expense'
    amountMinor: number
    sourceLine?: number
    occurredOn?: string
    runningBalance?: BankStatementSourceAmount | null
  }[],
) {
  const ordered = entries
    .map((entry, index) => ({ ...entry, index }))
    .sort((left, right) => (left.sourceLine ?? left.index) - (right.sourceLine ?? right.index))
  const checkpoints = ordered
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.runningBalance)

  if (checkpoints.length < 2) {
    return {
      status: 'unavailable' as const,
      checkedRows: 0,
      mismatchSourceLines: [] as number[],
    }
  }

  const forwardMismatches: number[] = []
  const reverseMismatches: number[] = []
  const checkedRows = checkpoints[checkpoints.length - 1]!.index - checkpoints[0]!.index
  for (let index = 1; index < checkpoints.length; index += 1) {
    const previous = checkpoints[index - 1]!
    const current = checkpoints[index]!
    const previousBalance = BigInt(previous.entry.runningBalance!.amountMinor)
    const currentBalance = BigInt(current.entry.runningBalance!.amountMinor)
    let forwardDelta = 0n
    let reverseDelta = 0n

    for (let rowIndex = previous.index; rowIndex <= current.index; rowIndex += 1) {
      const row = ordered[rowIndex]!
      const delta = BigInt(row.type === 'income' ? row.amountMinor : -row.amountMinor)
      if (rowIndex > previous.index) forwardDelta += delta
      if (rowIndex < current.index) reverseDelta += delta
    }

    if (previousBalance + forwardDelta !== currentBalance) {
      for (let rowIndex = previous.index + 1; rowIndex <= current.index; rowIndex += 1) {
        forwardMismatches.push(ordered[rowIndex]!.sourceLine ?? rowIndex + 1)
      }
    }
    if (currentBalance + reverseDelta !== previousBalance) {
      for (let rowIndex = previous.index; rowIndex < current.index; rowIndex += 1) {
        reverseMismatches.push(ordered[rowIndex]!.sourceLine ?? rowIndex + 1)
      }
    }
  }

  let physicalOrderIsForward: boolean | null = null
  for (let index = 1; index < ordered.length; index += 1) {
    const previousDate = ordered[index - 1]?.occurredOn
    const currentDate = ordered[index]?.occurredOn
    if (!previousDate || !currentDate || previousDate === currentDate) continue
    physicalOrderIsForward = previousDate < currentDate
    break
  }
  const mismatchSourceLines = physicalOrderIsForward === true
    ? forwardMismatches
    : physicalOrderIsForward === false
      ? reverseMismatches
      : forwardMismatches.length <= reverseMismatches.length
        ? forwardMismatches
        : reverseMismatches
  return {
    status: mismatchSourceLines.length === 0 ? 'matched' as const : 'mismatch' as const,
    checkedRows,
    mismatchSourceLines: [...new Set(mismatchSourceLines)],
  }
}

export function autoSelectedBankImportKeys(
  drafts: readonly Pick<BankImportDraft, 'flags' | 'importKey'>[],
  rows: readonly TransactionImportPreviewResult['rows'][number][],
  allowed = true,
) {
  if (!allowed) return new Set<string>()
  const safeDraftKeys = new Set(
    drafts
      .filter((draft) => draft.flags.every((flag) => flag === 'UNCERTAIN_CATEGORY'))
      .map((draft) => draft.importKey),
  )
  return new Set(
    rows
      .filter((row) =>
        safeDraftKeys.has(row.importKey)
        && (row.status === 'new' || row.status === 'match_ready'))
      .map((row) => row.importKey),
  )
}

const aiImportKeySchema = transactionImportKeySchema.refine(
  (value) => /^ai:statement:row:[0-9a-f]{64}$/.test(value),
)

export const aiImportRowSchema = transactionImportRowSchema
  .extend({ importKey: aiImportKeySchema })
  .strict()

export const aiImportRequestSchema = z
  .object({
    mode: z.enum(['preview', 'commit']),
    rows: z.array(aiImportRowSchema).min(1).max(MAX_TRANSACTION_IMPORT_ROWS),
  })
  .strict()

export type AiProviderConnection = z.infer<typeof aiProviderConnectionSchema>
export type AiProviderSettings = z.infer<typeof aiProviderSettingsSchema>
export type AiProviderSettingsWrite = z.infer<typeof aiProviderSettingsWriteSchema>
export type AiProviderSettingsMetadata = z.infer<typeof aiProviderSettingsMetadataSchema>
export type AiProviderSettingsRow = AiProviderSettingsMetadata
export type AiModelsProviderSource = z.infer<typeof aiModelsProviderSourceSchema>
export type AiParseProviderSource = z.infer<typeof aiParseProviderSourceSchema>
export type AiDateOrder = z.infer<typeof aiDateOrderSchema>
export type AiParseRequest = z.infer<typeof aiParseRequestSchema>
export type AiModelOutput = z.infer<typeof aiModelOutputSchema>
export type BankImportDraft = z.infer<typeof bankImportDraftSchema>
