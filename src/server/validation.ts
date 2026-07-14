import { z } from 'zod'
import { isValidCalendarDate } from '../lib/date'
import {
  accountRegisterClearingSchema,
  transactionQueryFieldsSchema,
} from '../lib/schema'

export { accountRegisterClearingSchema }
export type { AccountRegisterClearingInput } from '../lib/schema'

export const summaryQuerySchema = transactionQueryFieldsSchema.pick({ month: true }).strict()
export const accountBalanceQuerySchema = summaryQuerySchema
const accountRegisterMonthQuerySchema = transactionQueryFieldsSchema
  .pick({ month: true, accountId: true })
  .required({ accountId: true })
  .strict()
const accountRegisterRangeQuerySchema = transactionQueryFieldsSchema
  .pick({ dateFrom: true, dateTo: true, accountId: true })
  .required({ dateFrom: true, dateTo: true, accountId: true })
  .strict()
  .refine(({ dateFrom, dateTo }) => dateFrom <= dateTo, {
    path: ['dateTo'],
    message: '結束日期不得早於開始日期',
  })
export const accountRegisterQuerySchema = z.union([
  accountRegisterMonthQuerySchema,
  accountRegisterRangeQuerySchema,
])
export type AccountRegisterQuery = z.infer<typeof accountRegisterQuerySchema>
export const accountUnclearedReviewSchema = z
  .object({
    accountId: z.number().int().positive(),
    dateTo: z.string().refine(isValidCalendarDate, '結束日期必須是有效的 YYYY-MM-DD 日期'),
  })
  .strict()
export type AccountUnclearedReviewInput = z.infer<typeof accountUnclearedReviewSchema>
export const recurringRuleIdSchema = z.string().uuid('週期交易 ID 必須是 UUID')
export const recurringRunDueSchema = z
  .object({
    asOf: z.string().refine(isValidCalendarDate, '執行日期必須是有效的 YYYY-MM-DD 日期').optional(),
  })
  .strict()
export const emptyActionSchema = z.object({}).strict()
