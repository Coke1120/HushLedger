import { z } from 'zod'
import { isValidCalendarDate, monthRangeDates } from './date'

export const transactionTypeSchema = z.enum(['expense', 'income'])
export type TransactionType = z.infer<typeof transactionTypeSchema>
export const recurrenceFrequencySchema = z.enum(['daily', 'weekly', 'monthly'])

const calendarDateSchema = z
  .string()
  .refine(isValidCalendarDate, '交易日期必須是有效的 YYYY-MM-DD 日期')

export const transactionIdSchema = z.string().uuid('交易 ID 必須是 UUID')

const transactionFieldsSchema = z.object({
  type: transactionTypeSchema,
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency: z.literal('HKD').default('HKD'),
  accountId: z.number().int().positive(),
  categoryId: z.number().int().positive(),
  occurredOn: calendarDateSchema,
  payee: z.string().trim().max(80).default(''),
  note: z.string().trim().max(200).default(''),
})

export const transactionInputSchema = transactionFieldsSchema
  .extend({ id: transactionIdSchema })
  .strict()

export const transactionUpdateSchema = transactionFieldsSchema
  .extend({ updatedAt: z.string().datetime({ offset: true }) })
  .strict()

export const transactionDeleteSchema = z
  .object({ updatedAt: z.string().datetime({ offset: true }) })
  .strict()

export const transactionQuerySchema = z
  .object({
    month: z.string().refine((value) => {
      try {
        monthRangeDates(value)
        return true
      } catch {
        return false
      }
    }, '月份格式必須為有效的 YYYY-MM'),
    type: transactionTypeSchema.optional(),
    search: z.string().trim().min(1).max(80).optional(),
  })
  .strict()

export type TransactionInput = z.infer<typeof transactionInputSchema>
export type TransactionUpdateInput = z.infer<typeof transactionUpdateSchema>

export const accountLocalizationKeys = [
  'account.cash',
  'account.bank',
  'account.credit_card',
  'account.wallet',
] as const
export type AccountLocalizationKey = (typeof accountLocalizationKeys)[number]

export const categoryLocalizationKeys = [
  'category.salary',
  'category.other_income',
  'category.food',
  'category.transport',
  'category.living',
  'category.entertainment',
  'category.shopping',
  'category.housing',
  'category.bills',
  'category.healthcare',
  'category.other_expense',
] as const
export type CategoryLocalizationKey = (typeof categoryLocalizationKeys)[number]

export type Transaction = TransactionInput & {
  accountName: string
  accountLocalizationKey: AccountLocalizationKey | null
  categoryName: string
  categoryLocalizationKey: CategoryLocalizationKey | null
  categoryIcon: string
  categoryColor: string
  createdAt: string
  updatedAt: string
  recurringRuleId?: string | null
  recurringRuleName?: string | null
}

const recurringRuleFieldsSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: transactionTypeSchema,
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency: z.literal('HKD').default('HKD'),
  accountId: z.number().int().positive(),
  categoryId: z.number().int().positive(),
  frequency: recurrenceFrequencySchema,
  scheduleStartsOn: calendarDateSchema,
  isActive: z.boolean().default(true),
  payee: z.string().trim().max(80).default(''),
  note: z.string().trim().max(200).default(''),
})

export const recurringRuleCreateSchema = recurringRuleFieldsSchema.extend({
  id: z.string().uuid('週期交易 ID 必須是 UUID'),
}).strict()

export const recurringRuleUpdateSchema = recurringRuleFieldsSchema.extend({
  revision: z.number().int().positive(),
}).strict()
export const recurringRuleStatusSchema = z
  .object({ isActive: z.boolean(), revision: z.number().int().positive() })
  .strict()
export const recurringRuleDeleteSchema = z.object({ revision: z.number().int().positive() }).strict()

export type RecurrenceFrequency = z.infer<typeof recurrenceFrequencySchema>
export type RecurringRuleCreateInput = z.infer<typeof recurringRuleCreateSchema>
export type RecurringRuleUpdateInput = z.infer<typeof recurringRuleUpdateSchema>

export type RecurringRule = RecurringRuleCreateInput & {
  nextOccurrenceOn: string
  lastOccurrenceOn: string | null
  anchorDay: number
  generatedCount: number
  lastErrorCode: string | null
  revision: number
  createdAt: string
  updatedAt: string
}

export type RecurringGenerationResult = {
  asOf: string
  scanned: number
  created: number
  alreadyExisting: number
  blocked: number
  truncated: number
  failed: number
}

export type Summary = {
  month: string
  income: number
  expense: number
  balance: number
}

export type Account = {
  id: number
  name: string
  type: 'cash' | 'bank' | 'credit_card' | 'wallet'
  currency: 'HKD'
  isActive: boolean
  sortOrder: number
  localizationKey: AccountLocalizationKey | null
}

export type Category = {
  id: number
  name: string
  type: TransactionType
  icon: string
  color: string
  isActive: boolean
  sortOrder: number
  localizationKey: CategoryLocalizationKey | null
}

export type Lookup = {
  id: number
  name: string
  type?: TransactionType
}
