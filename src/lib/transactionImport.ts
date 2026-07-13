import { z } from 'zod'
import { transactionInputSchema } from './schema'

export const MAX_TRANSACTION_IMPORT_ROWS = 200

export const transactionImportKeySchema = z
  .string()
  .min(20)
  .max(160)
  .regex(
    /^(?:csv:hushledger:(?:id:[0-9a-f-]{36}|row:[0-9a-f]{64})|csv:bank:(?:id|row):[0-9a-f]{64}|ai:statement:row:[0-9a-f]{64})$/,
  )

export const transactionImportRowSchema = transactionInputSchema
  .extend({
    sourceRow: z.number().int().positive().max(1_000_000),
    importKey: transactionImportKeySchema,
    include: z.boolean(),
  })
  .strict()

export const transactionImportRowStatusSchema = z.enum([
  'new',
  'match_ready',
  'possible_duplicate',
  'already_imported',
  'existing_transaction',
  'id_conflict',
  'account_invalid',
  'category_invalid',
  'category_mismatch',
])

export const transactionImportPreviewRowSchema = z
  .object({
    sourceRow: z.number().int().positive(),
    importKey: transactionImportKeySchema,
    status: transactionImportRowStatusSchema,
  })
  .strict()

export const transactionImportPreviewResultSchema = z
  .object({
    rows: z.array(transactionImportPreviewRowSchema).max(MAX_TRANSACTION_IMPORT_ROWS),
    ready: z.number().int().nonnegative(),
    matchable: z.number().int().nonnegative(),
    possibleDuplicates: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    blocked: z.number().int().nonnegative(),
  })
  .strict()

export const transactionImportCommitResultSchema = transactionImportPreviewResultSchema
  .extend({
    imported: z.number().int().nonnegative(),
    matched: z.number().int().nonnegative(),
    staleSkipped: z.number().int().nonnegative(),
  })
  .strict()

export type TransactionImportRow = z.infer<typeof transactionImportRowSchema>
export type TransactionImportRowStatus = z.infer<typeof transactionImportRowStatusSchema>
export type TransactionImportPreviewRow = z.infer<typeof transactionImportPreviewRowSchema>
export type TransactionImportPreviewResult = z.infer<typeof transactionImportPreviewResultSchema>
export type TransactionImportCommitResult = z.infer<typeof transactionImportCommitResultSchema>
