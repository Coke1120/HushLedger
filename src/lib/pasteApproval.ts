import { z } from 'zod'
import { transactionInputSchema } from './schema'
import { transactionImportKeySchema } from './transactionImport'

export const pasteRowSchema = transactionInputSchema.extend({
  importKey: transactionImportKeySchema,
  duplicateConfirmed: z.boolean(),
}).strict()
export const pasteRowsSchema = z.array(pasteRowSchema).min(1).max(200)
  .refine((rows) => new Set(rows.map((row) => row.id)).size === rows.length)
  .refine((rows) => new Set(rows.map((row) => row.importKey)).size === rows.length)
  .refine((rows) => rows.every((row) => row.accountId === rows[0].accountId))

export const pasteRequestSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('preview'), rows: pasteRowsSchema }).strict(),
  z.object({
    mode: z.literal('approve'), operationId: z.uuid(),
    expectedRevision: z.number().int().positive(), rows: pasteRowsSchema,
  }).strict(),
  z.object({ mode: z.literal('undo'), operationId: z.uuid() }).strict(),
])
export type PasteRow = z.infer<typeof pasteRowSchema>
export type PastePreview = {
  revision: number
  rows: { id: string; duplicate: boolean; imported: boolean; valid: boolean }[]
}
export type PasteReceipt = { operationId: string; state: 'approved' | 'undone' | 'invalidated'; count: number }

export function sourceHasExplicitYear(source: string, date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const year = date.slice(0, 4)
  return new RegExp(`(?:^|[^0-9])(?:${year}[-/.年][0-9]{1,2}[-/.月][0-9]{1,2}|[0-9]{1,2}[-/.][0-9]{1,2}[-/.]${year})(?:[^0-9]|$)`).test(source)
}
