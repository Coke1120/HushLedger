import { z } from 'zod'

import { isValidCalendarDate } from './date'
import { transactionIdSchema } from './schema'
import { transactionImportKeySchema } from './transactionImport'

export const statementTransferImportKeySchema = transactionImportKeySchema.refine(
  (value) => /^ai:statement:row:[0-9a-f]{64}$/.test(value),
)

export const statementTransferImportInputSchema = z
  .object({
    importKey: statementTransferImportKeySchema,
    statementAccountId: z.number().int().positive(),
    counterpartyAccountId: z.number().int().positive(),
    amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    occurredOn: z.string().refine(isValidCalendarDate),
    direction: z.enum(['outflow', 'inflow']),
    note: z.string().trim().max(200),
  })
  .strict()
  .refine(
    ({ statementAccountId, counterpartyAccountId }) => (
      statementAccountId !== counterpartyAccountId
    ),
    { path: ['counterpartyAccountId'], message: '轉帳帳戶必須不同' },
  )

export const statementTransferImportResponseSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('created'), transferId: transactionIdSchema }).strict(),
  z.object({ kind: z.literal('matched'), transferId: transactionIdSchema }).strict(),
  z.object({ kind: z.literal('already_imported') }).strict(),
])

export type StatementTransferImportInput = z.infer<typeof statementTransferImportInputSchema>
export type StatementTransferImportResponse = z.infer<typeof statementTransferImportResponseSchema>
