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

export const aiDraftFlagSchema = z.enum([
  'UNCERTAIN_DATE',
  'UNCERTAIN_AMOUNT',
  'UNCERTAIN_DIRECTION',
  'UNCERTAIN_CATEGORY',
  'POSSIBLE_DUPLICATE',
  'POSSIBLE_TRANSFER',
  'NEEDS_REVIEW',
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
            suggestedCategoryName: z.string().trim().min(1).max(80).nullable(),
            confidence: z.number().min(0).max(1),
            flags: z.array(aiDraftFlagSchema).max(8),
          })
          .strict(),
      )
      .max(MAX_AI_DRAFT_ROWS),
  })
  .strict()

export const bankImportDraftSchema = z
  .object({
    id: z.string().uuid(),
    importKey: transactionImportKeySchema.refine(
      (value) => /^ai:statement:row:[0-9a-f]{64}$/.test(value),
    ),
    sourceLine: z.number().int().positive(),
    sourceText: z.string().max(240),
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
  entries: readonly { type: 'income' | 'expense'; amountMinor: number }[],
): BankStatementVerification {
  const parsed = exactTransactionTotals(entries)
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
