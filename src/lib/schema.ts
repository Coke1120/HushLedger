import { z } from 'zod'
import { isValidCalendarDate, monthRangeDates } from './date'
import { isTransactionTagName } from './transactionTags'

export const transactionTypeSchema = z.enum(['expense', 'income'])
export type TransactionType = z.infer<typeof transactionTypeSchema>
export const transactionClearingStatusSchema = z.enum(['cleared', 'uncleared'])
export type TransactionClearingStatus = z.infer<typeof transactionClearingStatusSchema>
export const transactionSortSchema = z.enum([
  'date_desc',
  'date_asc',
  'amount_desc',
  'amount_asc',
  'payee_asc',
  'payee_desc',
])
export type TransactionSort = z.infer<typeof transactionSortSchema>
export const accountTypeSchema = z.enum(['cash', 'bank', 'credit_card', 'wallet'])
export type AccountType = z.infer<typeof accountTypeSchema>
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
  .extend({ id: transactionIdSchema, cleared: z.boolean().default(false) })
  .strict()

export const transactionUpdateSchema = transactionFieldsSchema
  .extend({ cleared: z.boolean(), updatedAt: z.string().datetime({ offset: true }) })
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
    status: transactionClearingStatusSchema.optional(),
    accountId: z.coerce.number().int().positive().optional(),
    categoryId: z.coerce.number().int().positive().optional(),
    search: z.string().trim().min(1).max(80).optional(),
    tag: z.string().refine(isTransactionTagName, '標籤格式不正確').optional(),
    sort: transactionSortSchema.optional(),
  })
  .strict()

export type TransactionInput = z.infer<typeof transactionInputSchema>
export type TransactionUpdateInput = z.infer<typeof transactionUpdateSchema>

const referenceNameSchema = z.string().trim().min(1).max(80)
const updatedReferenceSchema = z.object({
  updatedAt: z.string().datetime({ offset: true }),
})

export const referenceIdSchema = z.coerce.number().int().positive()
export const accountCreateSchema = z
  .object({ name: referenceNameSchema, type: accountTypeSchema })
  .strict()
export const accountUpdateSchema = accountCreateSchema
  .extend(updatedReferenceSchema.shape)
  .strict()
const categoryMonthlyPlanSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER)
  .nullable()
  .default(null)
const categoryFieldsSchema = z.object({
  name: referenceNameSchema,
  type: transactionTypeSchema,
  monthlyPlanMinor: categoryMonthlyPlanSchema,
})
const validateCategoryMonthlyPlan = (
  value: { type: TransactionType; monthlyPlanMinor: number | null },
  context: z.RefinementCtx,
) => {
  if (value.type === 'income' && value.monthlyPlanMinor !== null) {
    context.addIssue({
      code: 'custom',
      path: ['monthlyPlanMinor'],
      message: '收入分類不可設定每月支出計劃',
    })
  }
}
export const categoryCreateSchema = z
  .object(categoryFieldsSchema.shape)
  .strict()
  .superRefine(validateCategoryMonthlyPlan)
export const categoryUpdateSchema = z
  .object(categoryFieldsSchema.shape)
  .extend(updatedReferenceSchema.shape)
  .strict()
  .superRefine(validateCategoryMonthlyPlan)
export const referenceStatusSchema = z
  .object({ isActive: z.boolean() })
  .extend(updatedReferenceSchema.shape)
  .strict()
const referenceOrderItemSchema = z
  .object({ id: z.number().int().positive() })
  .extend(updatedReferenceSchema.shape)
  .strict()
export const referenceOrderSchema = z
  .object({ items: z.array(referenceOrderItemSchema).min(2).max(200) })
  .strict()
  .superRefine(({ items }, context) => {
    const seen = new Set<number>()
    for (const [index, item] of items.entries()) {
      if (seen.has(item.id)) {
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'id'],
          message: '項目 ID 不可重複',
        })
      }
      seen.add(item.id)
    }
  })

export type AccountCreateInput = z.infer<typeof accountCreateSchema>
export type AccountUpdateInput = z.infer<typeof accountUpdateSchema>
export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>
export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>
export type ReferenceStatusInput = z.infer<typeof referenceStatusSchema>
export type ReferenceOrderInput = z.infer<typeof referenceOrderSchema>

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

export type TransactionFilterSummary = {
  transactionCount: number
  income: number
  expense: number
  net: number
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
  firstOccurrenceOn: calendarDateSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.firstOccurrenceOn && value.firstOccurrenceOn < value.scheduleStartsOn) {
    context.addIssue({
      code: 'custom',
      path: ['firstOccurrenceOn'],
      message: '首次產生日期不得早於週期起始日',
    })
  }
})

export const recurringRuleUpdateSchema = recurringRuleFieldsSchema.extend({
  revision: z.number().int().positive(),
}).strict()
export const recurringRuleStatusSchema = z
  .object({ isActive: z.boolean(), revision: z.number().int().positive() })
  .strict()
export const recurringRuleSkipSchema = z
  .object({
    revision: z.number().int().positive(),
    nextOccurrenceOn: calendarDateSchema,
  })
  .strict()
export const recurringRuleDeleteSchema = z.object({ revision: z.number().int().positive() }).strict()

export type RecurrenceFrequency = z.infer<typeof recurrenceFrequencySchema>
export type RecurringRuleCreateInput = z.infer<typeof recurringRuleCreateSchema>
export type RecurringRuleUpdateInput = z.infer<typeof recurringRuleUpdateSchema>
export type RecurringRuleSkipInput = z.infer<typeof recurringRuleSkipSchema>

export type RecurringRule = Omit<RecurringRuleCreateInput, 'firstOccurrenceOn'> & {
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
  spendingTrend: MonthlySpendingSummary[]
  expenseByCategory: ExpenseCategorySummary[]
  monthlySpendingPlans: MonthlySpendingPlanSummary[]
  recurringForecast: ScheduledRecurringSummary[]
}

export type MonthlySpendingSummary = {
  month: string
  amountMinor: number
  transactionCount: number
}

export type ExpenseCategorySummary = {
  categoryId: number
  categoryName: string
  categoryLocalizationKey: CategoryLocalizationKey | null
  categoryIcon: string
  categoryColor: string
  amountMinor: number
  transactionCount: number
}

export type MonthlySpendingPlanSummary = {
  categoryId: number
  categoryName: string
  categoryLocalizationKey: CategoryLocalizationKey | null
  categoryIcon: string
  categoryColor: string
  plannedMinor: number
  spentMinor: number
}

export type ScheduledRecurringSummary = {
  recurringRuleId: string
  name: string
  type: TransactionType
  amountMinor: number
  frequency: RecurrenceFrequency
  firstOccurrenceOn: string
  occurrenceCount: number
}

export type PayeeSuggestion = {
  payee: string
  type: TransactionType
  accountId: number
  categoryId: number
  lastUsedOn: string
  useCount: number
}

export type Account = {
  id: number
  name: string
  type: AccountType
  currency: 'HKD'
  isActive: boolean
  sortOrder: number
  localizationKey: AccountLocalizationKey | null
  updatedAt: string
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
  monthlyPlanMinor: number | null
  updatedAt: string
}

export type Lookup = {
  id: number
  name: string
  type?: TransactionType
}
