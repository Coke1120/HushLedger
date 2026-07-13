import { z } from 'zod'
import {
  DEFAULT_LEDGER_CURRENCY,
  supportedCurrencySchema,
  type SupportedCurrency,
} from './currency'
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
export const transactionDateScopeSchema = z.enum(['month', 'range', 'all'])
export type TransactionDateScope = z.infer<typeof transactionDateScopeSchema>
export const accountTypeSchema = z.enum(['cash', 'bank', 'credit_card', 'wallet'])
export type AccountType = z.infer<typeof accountTypeSchema>
export const recurrenceFrequencySchema = z.enum(['daily', 'weekly', 'monthly', 'yearly'])

const calendarDateSchema = z
  .string()
  .refine(isValidCalendarDate, '交易日期必須是有效的 YYYY-MM-DD 日期')

export const transactionIdSchema = z.string().uuid('交易 ID 必須是 UUID')

const transactionFieldsSchema = z.object({
  type: transactionTypeSchema,
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency: supportedCurrencySchema,
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

const transactionVersionSchema = z
  .object({
    id: transactionIdSchema,
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict()

const transactionVersionBatchSchema = z
  .array(transactionVersionSchema)
  .min(1)
  .max(200)
  .superRefine((transactions, context) => {
    const ids = new Set<string>()
    transactions.forEach((transaction, index) => {
      if (ids.has(transaction.id)) {
        context.addIssue({
          code: 'custom',
          path: [index, 'id'],
          message: '每筆交易只能選取一次',
        })
      }
      ids.add(transaction.id)
    })
  })

export const transactionClearingBatchSchema = z
  .object({
    cleared: z.boolean(),
    transactions: transactionVersionBatchSchema,
  })
  .strict()

export const transactionCategoryBatchSchema = z
  .object({
    categoryId: z.number().int().positive(),
    transactions: transactionVersionBatchSchema,
  })
  .strict()

export const transactionDuplicateCheckSchema = transactionFieldsSchema
  .extend({ excludeId: transactionIdSchema.optional() })
  .strict()

const accountTransferFields = {
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency: supportedCurrencySchema,
  fromAccountId: z.number().int().positive(),
  toAccountId: z.number().int().positive(),
  occurredOn: calendarDateSchema,
  fromCleared: z.boolean().default(false),
  toCleared: z.boolean().default(false),
  note: z.string().trim().max(200).default(''),
}

const validateTransferAccounts = (
  value: { fromAccountId: number; toAccountId: number },
  context: z.RefinementCtx,
) => {
  if (value.fromAccountId === value.toAccountId) {
    context.addIssue({
      code: 'custom',
      path: ['toAccountId'],
      message: '轉出及轉入帳戶必須不同',
    })
  }
}

export const accountTransferInputSchema = z
  .object({ id: transactionIdSchema, ...accountTransferFields })
  .strict()
  .superRefine(validateTransferAccounts)

export const accountTransferUpdateSchema = z
  .object({
    ...accountTransferFields,
    currency: supportedCurrencySchema,
    fromCleared: z.boolean(),
    toCleared: z.boolean(),
    note: z.string().trim().max(200),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine(validateTransferAccounts)

export const accountTransferDeleteSchema = transactionDeleteSchema

export const accountTransferQuerySchema = z
  .object({
    month: z.string().refine((value) => {
      try {
        monthRangeDates(value)
        return true
      } catch {
        return false
      }
    }, '月份格式必須為有效的 YYYY-MM'),
    accountId: z.coerce.number().int().positive().optional(),
  })
  .strict()

export const transactionQueryFieldsSchema = z
  .object({
    month: z.string().refine((value) => {
      try {
        monthRangeDates(value)
        return true
      } catch {
        return false
      }
    }, '月份格式必須為有效的 YYYY-MM'),
    scope: transactionDateScopeSchema.default('month'),
    dateFrom: calendarDateSchema.optional(),
    dateTo: calendarDateSchema.optional(),
    type: transactionTypeSchema.optional(),
    status: transactionClearingStatusSchema.optional(),
    accountId: z.coerce.number().int().positive().optional(),
    categoryId: z.coerce.number().int().positive().optional(),
    payee: z.string().trim().min(1).max(80).optional(),
    search: z.string().trim().min(1).max(80).optional(),
    tag: z.string().refine(isTransactionTagName, '標籤格式不正確').optional(),
    duplicates: z.literal('exact').optional(),
    sort: transactionSortSchema.optional(),
  })
  .strict()

export const transactionQuerySchema = transactionQueryFieldsSchema
  .superRefine((query, context) => {
    if (query.scope === 'range') {
      if (!query.dateFrom) {
        context.addIssue({ code: 'custom', path: ['dateFrom'], message: '自訂日期範圍需要開始日期' })
      }
      if (!query.dateTo) {
        context.addIssue({ code: 'custom', path: ['dateTo'], message: '自訂日期範圍需要結束日期' })
      }
      if (query.dateFrom && query.dateTo && query.dateFrom > query.dateTo) {
        context.addIssue({ code: 'custom', path: ['dateTo'], message: '結束日期不得早於開始日期' })
      }
      return
    }

    if (query.dateFrom !== undefined) {
      context.addIssue({ code: 'custom', path: ['dateFrom'], message: '此日期範圍不接受開始日期' })
    }
    if (query.dateTo !== undefined) {
      context.addIssue({ code: 'custom', path: ['dateTo'], message: '此日期範圍不接受結束日期' })
    }
  })

export type TransactionQuery = z.infer<typeof transactionQuerySchema>
export type TransactionInput = z.infer<typeof transactionInputSchema>
export type TransactionUpdateInput = z.infer<typeof transactionUpdateSchema>
export type TransactionCategoryBatchInput = z.infer<typeof transactionCategoryBatchSchema>
export type TransactionClearingBatchInput = z.infer<typeof transactionClearingBatchSchema>
export type TransactionDuplicateCheckInput = z.infer<typeof transactionDuplicateCheckSchema>
export type AccountTransferInput = z.infer<typeof accountTransferInputSchema>
export type AccountTransferUpdateInput = z.infer<typeof accountTransferUpdateSchema>

const referenceNameSchema = z.string().trim().min(1).max(80)
const expectedLedgerCurrencySchema = supportedCurrencySchema.default(DEFAULT_LEDGER_CURRENCY)
const updatedReferenceSchema = z.object({
  updatedAt: z.string().datetime({ offset: true }),
})

export const referenceIdSchema = z.coerce.number().int().positive()
const signedMinorSchema = z
  .number()
  .int()
  .min(-Number.MAX_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER)
  .nullable()
const accountOpeningFields = {
  openingBalanceMinor: signedMinorSchema,
  openingBalanceOn: calendarDateSchema.nullable(),
}
const validateAccountOpeningBalance = (
  value: { openingBalanceMinor: number | null; openingBalanceOn: string | null },
  context: z.RefinementCtx,
) => {
  if ((value.openingBalanceMinor === null) !== (value.openingBalanceOn === null)) {
    context.addIssue({
      code: 'custom',
      path: ['openingBalanceOn'],
      message: '期初結餘及日期必須同時提供或同時留空',
    })
  }
}
export const accountCreateSchema = z
  .object({
    name: referenceNameSchema,
    type: accountTypeSchema,
    expectedCurrency: expectedLedgerCurrencySchema,
    openingBalanceMinor: signedMinorSchema.default(null),
    openingBalanceOn: calendarDateSchema.nullable().default(null),
  })
  .strict()
  .superRefine(validateAccountOpeningBalance)
export const accountUpdateSchema = z.object({
  name: referenceNameSchema,
  type: accountTypeSchema,
  expectedCurrency: expectedLedgerCurrencySchema,
  ...accountOpeningFields,
})
  .extend(updatedReferenceSchema.shape)
  .strict()
  .superRefine(validateAccountOpeningBalance)
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
  expectedCurrency: expectedLedgerCurrencySchema,
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

const emergencyFundGoalVersionSchema = z.string().datetime({ offset: true })
export const emergencyFundGoalSaveSchema = z
  .object({
    accountId: z.number().int().positive(),
    targetMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    expectedCurrency: expectedLedgerCurrencySchema,
    expectedUpdatedAt: emergencyFundGoalVersionSchema.nullable(),
  })
  .strict()
export const emergencyFundGoalDeleteSchema = z
  .object({ expectedUpdatedAt: emergencyFundGoalVersionSchema })
  .strict()

export type AccountCreateInput = z.infer<typeof accountCreateSchema>
export type AccountUpdateInput = z.infer<typeof accountUpdateSchema>
export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>
export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>
export type ReferenceStatusInput = z.infer<typeof referenceStatusSchema>
export type ReferenceOrderInput = z.infer<typeof referenceOrderSchema>
export type EmergencyFundGoalSaveInput = z.infer<typeof emergencyFundGoalSaveSchema>
export type EmergencyFundGoalDeleteInput = z.infer<typeof emergencyFundGoalDeleteSchema>

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

export type AccountTransfer = AccountTransferInput & {
  fromAccountName: string
  fromAccountLocalizationKey: AccountLocalizationKey | null
  toAccountName: string
  toAccountLocalizationKey: AccountLocalizationKey | null
  createdAt: string
  updatedAt: string
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
  currency: supportedCurrencySchema,
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
  cashFlowTrend: MonthlyCashFlowSummary[]
  /** @deprecated Retained temporarily so an older cached app shell can read a newer API response. */
  spendingTrend: MonthlySpendingSummary[]
  expenseByCategory: ExpenseCategorySummary[]
  expenseByPayee: ExpensePayeeSummary[]
  monthlySpendingPlans: MonthlySpendingPlanSummary[]
  recurringForecast: ScheduledRecurringSummary[]
}

export type MonthlyCashFlowSummary = {
  month: string
  incomeMinor: number | null
  expenseMinor: number | null
  netMinor: number | null
  transactionCount: number
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
  /** Zero means no prior spending; null means unsafe to compare; missing means an older API. */
  previousMonthAmountMinor?: number | null
}

export type ExpensePayeeSummary = {
  payee: string
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
  payee: string
  /** Missing only when a cached newer app shell reads an older API response. */
  accountId?: number
  /** Missing only when a cached newer app shell reads an older API response. */
  categoryId?: number
  frequency: RecurrenceFrequency
  firstOccurrenceOn: string
  occurrenceCount: number
  occurrenceDates: string[]
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
  currency: SupportedCurrency
  isActive: boolean
  sortOrder: number
  localizationKey: AccountLocalizationKey | null
  openingBalanceMinor: number | null
  openingBalanceOn: string | null
  updatedAt: string
}

export type AccountBalance = {
  accountId: number
  accountName: string
  accountLocalizationKey: AccountLocalizationKey | null
  accountType: AccountType
  isActive: boolean
  openingBalanceMinor: number | null
  openingBalanceOn: string | null
  recordedBalance: number | null
  clearedBalance: number | null
  unclearedBalance: number | null
  /** Missing only when a cached newer app shell reads an older API response. */
  unclearedCount?: number | null
}

export type EmergencyFundGoal = {
  accountId: number
  targetMinor: number
  createdAt: string
  updatedAt: string
}

export type AccountRegisterEntry = {
  entryId: string
  sourceId: string | null
  kind: 'opening' | 'transaction' | 'transfer'
  occurredOn: string
  amountMinor: number
  runningBalanceMinor: number
  cleared: boolean | null
  payee: string
  note: string
  categoryName: string | null
  categoryLocalizationKey: CategoryLocalizationKey | null
  counterpartyAccountName: string | null
  counterpartyAccountLocalizationKey: AccountLocalizationKey | null
  transferDirection: 'in' | 'out' | null
}

export type AccountRegister = {
  accountId: number
  accountName: string
  accountLocalizationKey: AccountLocalizationKey | null
  month: string
  availableFrom: string | null
  startingBalanceMinor: number | null
  endingBalanceMinor: number | null
  entryCount: number
  entries: AccountRegisterEntry[]
}

export type NetWorthTrendPoint = {
  month: string
  netWorthMinor: number | null
  accountCount: number
  unavailableAccountCount: number
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
