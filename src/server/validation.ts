import { z } from 'zod'
import { isValidCalendarDate } from '../lib/date'
import { transactionQueryFieldsSchema } from '../lib/schema'

export const summaryQuerySchema = transactionQueryFieldsSchema.pick({ month: true }).strict()
export const accountBalanceQuerySchema = summaryQuerySchema
export const accountRegisterQuerySchema = transactionQueryFieldsSchema
  .pick({ month: true, accountId: true })
  .required({ accountId: true })
  .strict()
export const recurringRuleIdSchema = z.string().uuid('週期交易 ID 必須是 UUID')
export const recurringRunDueSchema = z
  .object({
    asOf: z.string().refine(isValidCalendarDate, '執行日期必須是有效的 YYYY-MM-DD 日期').optional(),
  })
  .strict()
export const emptyActionSchema = z.object({}).strict()
