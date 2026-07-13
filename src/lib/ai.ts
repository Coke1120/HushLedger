import { z } from 'zod'
import { supportedCurrencySchema } from './currency'
import { isValidCalendarDate } from './date'
import { transactionTypeSchema } from './schema'
import {
  MAX_TRANSACTION_IMPORT_ROWS,
  transactionImportKeySchema,
  transactionImportRowSchema,
} from './transactionImport'

export const MAX_AI_STATEMENT_BYTES = 64 * 1024
export const MAX_AI_PARSE_REQUEST_BYTES = 512 * 1024
export const MAX_AI_MODELS_REQUEST_BYTES = 8 * 1024
export const MAX_AI_MODELS_RESPONSE_BYTES = 64 * 1024
export const MAX_AI_COMPLETION_RESPONSE_BYTES = 256 * 1024
export const MAX_AI_DRAFT_ROWS = 200
export const MAX_AI_IMPORT_REQUEST_BYTES = 256 * 1024

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

export const aiModelsRequestSchema = z
  .object({ provider: aiProviderConnectionSchema })
  .strict()

export const aiDateOrderSchema = z.enum(['DMY', 'MDY', 'YMD'])

export const aiParseRequestSchema = z
  .object({
    provider: aiProviderSettingsSchema,
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

export const aiModelOutputSchema = z
  .object({
    rows: z
      .array(
        z
          .object({
            sourceLine: z.number().int().positive(),
            occurredOn: z.string().refine(isValidCalendarDate),
            direction: transactionTypeSchema,
            amountText: boundedText(32),
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
export type AiDateOrder = z.infer<typeof aiDateOrderSchema>
export type AiParseRequest = z.infer<typeof aiParseRequestSchema>
export type AiModelOutput = z.infer<typeof aiModelOutputSchema>
export type BankImportDraft = z.infer<typeof bankImportDraftSchema>
