import { z } from 'zod'
import { aiParseProviderSourceSchema } from './ai'
import { supportedCurrencySchema } from './currency'
import { isValidCalendarDate, monthRangeDates } from './date'
import {
  accountTypeSchema,
  recurringRuleCreateSchema,
  recurrenceFrequencySchema,
  transactionInputSchema,
  transactionTypeSchema,
  type Account,
  type Category,
  type Summary,
} from './schema'
import { summarizeRecurringForecast } from './recurringForecast'

export const MAX_AI_COPILOT_PROMPT_LENGTH = 2_000
export const MAX_AI_COPILOT_REPLY_LENGTH = 4_000
export const MAX_AI_COPILOT_ACTIONS = 5
export const MAX_AI_COPILOT_EVIDENCE = 6
export const MAX_AI_COPILOT_INSIGHTS = 5
export const MAX_AI_COPILOT_CONTEXT_ITEMS = 200
export const AI_COPILOT_MEANINGFUL_INCREASE_BASIS_POINTS = 2_500
export const AI_COPILOT_MEANINGFUL_INCREASE_MINOR = 1_000

const unsignedMinorSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const signedMinorSchema = z
  .number()
  .int()
  .min(-Number.MAX_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER)
const countSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const referenceNameSchema = z.string().trim().min(1).max(80)
const monthSchema = z.string().refine((value) => {
  try {
    monthRangeDates(value)
    return true
  } catch {
    return false
  }
}, 'Month must be a valid YYYY-MM value')
const calendarDateSchema = z.string().refine(isValidCalendarDate, 'Date must be a valid YYYY-MM-DD value')

export const aiCopilotLocaleSchema = z.enum(['zh-Hant', 'en', 'ja', 'fr'])
export const aiCopilotContextDigestSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'Context digest must be a lowercase SHA-256 hex value')

export const aiCopilotRequestSchema = z
  .object({
    provider: aiParseProviderSourceSchema,
    locale: aiCopilotLocaleSchema,
    month: monthSchema,
    expectedContextDigest: aiCopilotContextDigestSchema,
    prompt: z.string().trim().min(1).max(MAX_AI_COPILOT_PROMPT_LENGTH),
  })
  .strict()

export const aiCopilotSummaryTotalsSchema = z
  .object({
    incomeMinor: unsignedMinorSchema,
    expenseMinor: unsignedMinorSchema,
    netMinor: signedMinorSchema,
  })
  .strict()

export const aiCopilotExpenseCategoryComparisonSchema = z
  .object({
    categoryId: z.number().int().positive(),
    categoryName: referenceNameSchema,
    amountMinor: unsignedMinorSchema,
    previousMonthAmountMinor: unsignedMinorSchema.nullable(),
    transactionCount: countSchema,
  })
  .strict()

export const aiCopilotMonthlySpendingPlanSchema = z
  .object({
    categoryId: z.number().int().positive(),
    categoryName: referenceNameSchema,
    plannedMinor: unsignedMinorSchema,
    spentMinor: unsignedMinorSchema,
  })
  .strict()

export const aiCopilotScheduledOutlookTotalsSchema = z
  .object({
    startOn: calendarDateSchema,
    endOnExclusive: calendarDateSchema,
    incomeMinor: unsignedMinorSchema,
    expenseMinor: unsignedMinorSchema,
    netMinor: signedMinorSchema,
  })
  .strict()
  .refine(({ startOn, endOnExclusive }) => startOn < endOnExclusive, {
    path: ['endOnExclusive'],
    message: 'Scheduled outlook end must be after its start',
  })

export const aiCopilotAttentionCountsSchema = z
  .object({
    duplicates: countSchema,
    unreviewed: countSchema,
    needsFollowUp: countSchema,
  })
  .strict()

export const aiCopilotAccountReferenceSchema = z
  .object({
    id: z.number().int().positive(),
    name: referenceNameSchema,
    type: accountTypeSchema,
    currency: supportedCurrencySchema,
  })
  .strict()

export const aiCopilotCategoryReferenceSchema = z
  .object({
    id: z.number().int().positive(),
    name: referenceNameSchema,
    type: transactionTypeSchema,
  })
  .strict()

export const aiCopilotOmissionCountsSchema = z
  .object({
    expenseCategoryComparisons: countSchema,
    monthlySpendingPlans: countSchema,
    activeAccounts: countSchema,
    activeCategories: countSchema,
  })
  .strict()

export const aiCopilotContextCoverageSchema = z
  .object({
    partial: z.boolean(),
    omissionCounts: aiCopilotOmissionCountsSchema,
  })
  .strict()
  .refine(({ partial, omissionCounts }) => (
    partial === Object.values(omissionCounts).some((count) => count > 0)
  ), {
    path: ['partial'],
    message: 'Partial context must match the omission counts',
  })

export const aiCopilotContextSchema = z
  .object({
    month: monthSchema,
    currency: supportedCurrencySchema,
    summary: aiCopilotSummaryTotalsSchema,
    expenseCategoryComparisons: z
      .array(aiCopilotExpenseCategoryComparisonSchema)
      .max(MAX_AI_COPILOT_CONTEXT_ITEMS),
    monthlySpendingPlans: z
      .array(aiCopilotMonthlySpendingPlanSchema)
      .max(MAX_AI_COPILOT_CONTEXT_ITEMS),
    scheduledOutlook: aiCopilotScheduledOutlookTotalsSchema,
    attention: aiCopilotAttentionCountsSchema,
    activeAccounts: z.array(aiCopilotAccountReferenceSchema).max(MAX_AI_COPILOT_CONTEXT_ITEMS),
    activeCategories: z.array(aiCopilotCategoryReferenceSchema).max(MAX_AI_COPILOT_CONTEXT_ITEMS),
    omissionCounts: aiCopilotOmissionCountsSchema,
  })
  .strict()
  .superRefine((context, refinement) => {
    const expectedStart = `${context.month}-01`
    const expectedEnd = nextMonthStart(context.month)
    if (context.scheduledOutlook.startOn !== expectedStart) {
      refinement.addIssue({
        code: 'custom',
        path: ['scheduledOutlook', 'startOn'],
        message: 'Recurring forecast must start with the selected month',
      })
    }
    if (context.scheduledOutlook.endOnExclusive !== expectedEnd) {
      refinement.addIssue({
        code: 'custom',
        path: ['scheduledOutlook', 'endOnExclusive'],
        message: 'Recurring forecast must end with the selected month',
      })
    }
  })

export const aiCopilotTransactionFiltersSchema = z
  .object({
    transactionType: z.enum(['all', 'expense', 'income']),
    categoryId: z.number().int().positive().nullable(),
    importReviewStatus: z.enum(['all', 'unreviewed', 'needs_follow_up', 'reviewed']),
    duplicatesOnly: z.boolean(),
    search: z.string().trim().min(1).max(80).nullable(),
  })
  .strict()

export const aiCopilotOverviewReviewSchema = z.enum([
  'netWorth',
  'cashFlow',
  'income',
  'spending',
  'plans',
  'outlook',
])

export const aiCopilotSummaryMetricSchema = z.enum(['income', 'expense', 'net'])
export const aiCopilotAttentionMetricSchema = z.enum([
  'duplicates',
  'unreviewed',
  'needs_follow_up',
])

export const aiCopilotEvidenceReferenceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('summary'),
    metric: aiCopilotSummaryMetricSchema,
  }).strict(),
  z.object({
    kind: z.literal('category_comparison'),
    categoryId: z.number().int().positive(),
  }).strict(),
  z.object({
    kind: z.literal('monthly_plan'),
    categoryId: z.number().int().positive(),
  }).strict(),
  z.object({ kind: z.literal('scheduled_outlook') }).strict(),
  z.object({
    kind: z.literal('attention'),
    metric: aiCopilotAttentionMetricSchema,
  }).strict(),
])

export const aiCopilotEvidenceReferencesSchema = z
  .array(aiCopilotEvidenceReferenceSchema)
  .max(MAX_AI_COPILOT_EVIDENCE)

const showTransactionsActionSchema = z
  .object({
    type: z.literal('show_transactions'),
    filters: aiCopilotTransactionFiltersSchema,
  })
  .strict()

const navigationActionSchema = z.discriminatedUnion('type', [
  showTransactionsActionSchema,
  z
    .object({
      type: z.literal('show_overview'),
      review: aiCopilotOverviewReviewSchema,
    })
    .strict(),
  z.object({ type: z.literal('open_recurring') }).strict(),
  z.object({ type: z.literal('open_ai_import') }).strict(),
])

export const aiCopilotTransactionDraftInputSchema = z
  .object({
    type: transactionTypeSchema,
    amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    accountId: z.number().int().positive(),
    categoryId: z.number().int().positive(),
    occurredOn: calendarDateSchema,
    payee: z.string().trim().max(80),
    note: z.string().trim().max(200),
  })
  .strict()

export const aiCopilotRecurringRuleDraftInputSchema = z
  .object({
    name: referenceNameSchema,
    type: transactionTypeSchema,
    amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    accountId: z.number().int().positive(),
    categoryId: z.number().int().positive(),
    frequency: recurrenceFrequencySchema,
    scheduleStartsOn: calendarDateSchema,
    scheduleEndsOn: calendarDateSchema.nullable(),
    firstOccurrenceOn: calendarDateSchema.nullable(),
    payee: z.string().trim().max(80),
    note: z.string().trim().max(200),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.scheduleEndsOn && value.scheduleEndsOn < value.scheduleStartsOn) {
      context.addIssue({
        code: 'custom',
        path: ['scheduleEndsOn'],
        message: 'Recurring schedule end must not precede its start',
      })
    }
    if (value.firstOccurrenceOn && value.firstOccurrenceOn < value.scheduleStartsOn) {
      context.addIssue({
        code: 'custom',
        path: ['firstOccurrenceOn'],
        message: 'First occurrence must not precede the schedule start',
      })
    }
    if (value.scheduleEndsOn && value.firstOccurrenceOn && value.scheduleEndsOn < value.firstOccurrenceOn) {
      context.addIssue({
        code: 'custom',
        path: ['scheduleEndsOn'],
        message: 'Recurring schedule end must not precede the first occurrence',
      })
    }
  })

const modelDraftActionSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('draft_transaction'),
      input: aiCopilotTransactionDraftInputSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('draft_recurring_rule'),
      input: aiCopilotRecurringRuleDraftInputSchema,
    })
    .strict(),
])

export const aiCopilotModelActionSchema = z.union([
  navigationActionSchema,
  modelDraftActionSchema,
])

export const aiCopilotModelOutputSchema = z
  .object({
    reply: z.string().trim().min(1).max(MAX_AI_COPILOT_REPLY_LENGTH),
    actions: z.array(aiCopilotModelActionSchema).max(MAX_AI_COPILOT_ACTIONS),
    evidenceReferences: aiCopilotEvidenceReferencesSchema,
  })
  .strict()

export const aiCopilotEvidenceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('summary'),
    month: monthSchema,
    currency: supportedCurrencySchema,
    metric: aiCopilotSummaryMetricSchema,
    amountMinor: signedMinorSchema,
  }).strict(),
  z.object({
    kind: z.literal('category_comparison'),
    month: monthSchema,
    currency: supportedCurrencySchema,
    categoryId: z.number().int().positive(),
    categoryName: referenceNameSchema,
    amountMinor: unsignedMinorSchema,
    previousMonthAmountMinor: unsignedMinorSchema.nullable(),
    transactionCount: countSchema,
  }).strict(),
  z.object({
    kind: z.literal('monthly_plan'),
    month: monthSchema,
    currency: supportedCurrencySchema,
    categoryId: z.number().int().positive(),
    categoryName: referenceNameSchema,
    plannedMinor: unsignedMinorSchema,
    spentMinor: unsignedMinorSchema,
  }).strict(),
  z.object({
    kind: z.literal('scheduled_outlook'),
    currency: supportedCurrencySchema,
    startOn: calendarDateSchema,
    endOnExclusive: calendarDateSchema,
    incomeMinor: unsignedMinorSchema,
    expenseMinor: unsignedMinorSchema,
    netMinor: signedMinorSchema,
  }).strict(),
  z.object({
    kind: z.literal('attention'),
    month: monthSchema,
    metric: aiCopilotAttentionMetricSchema,
    count: countSchema,
  }).strict(),
])

export const aiCopilotEvidenceListSchema = z
  .array(aiCopilotEvidenceSchema)
  .max(MAX_AI_COPILOT_EVIDENCE)

const normalizedDraftActionSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('draft_transaction'),
      input: transactionInputSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('draft_recurring_rule'),
      input: recurringRuleCreateSchema,
    })
    .strict(),
])

export const aiCopilotActionSchema = z.union([
  navigationActionSchema,
  normalizedDraftActionSchema,
])

export const aiCopilotResponseSchema = z
  .object({
    reply: z.string().trim().min(1).max(MAX_AI_COPILOT_REPLY_LENGTH),
    actions: z.array(aiCopilotActionSchema).max(MAX_AI_COPILOT_ACTIONS),
    evidence: aiCopilotEvidenceListSchema,
    context: aiCopilotContextCoverageSchema,
    contextDigest: aiCopilotContextDigestSchema,
  })
  .strict()

const insightBase = {
  severity: z.enum(['attention', 'warning']),
} as const

export const aiCopilotInsightSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('duplicates'),
    ...insightBase,
    count: countSchema.positive(),
    action: showTransactionsActionSchema,
  }).strict(),
  z.object({
    kind: z.literal('import_attention'),
    ...insightBase,
    unreviewed: countSchema,
    needsFollowUp: countSchema,
    action: showTransactionsActionSchema,
  }).strict().refine(({ unreviewed, needsFollowUp }) => unreviewed + needsFollowUp > 0),
  z.object({
    kind: z.literal('over_plan'),
    ...insightBase,
    categoryId: z.number().int().positive(),
    categoryName: referenceNameSchema,
    plannedMinor: unsignedMinorSchema,
    spentMinor: unsignedMinorSchema,
    overByMinor: unsignedMinorSchema.positive(),
    action: showTransactionsActionSchema,
  }).strict(),
  z.object({
    kind: z.literal('spending_increase'),
    ...insightBase,
    categoryId: z.number().int().positive(),
    categoryName: referenceNameSchema,
    amountMinor: unsignedMinorSchema,
    previousMonthAmountMinor: unsignedMinorSchema.positive(),
    increaseMinor: unsignedMinorSchema.positive(),
    increaseBasisPoints: z.number().int().positive(),
    action: showTransactionsActionSchema,
  }).strict(),
  z.object({
    kind: z.literal('scheduled_deficit'),
    ...insightBase,
    incomeMinor: unsignedMinorSchema,
    expenseMinor: unsignedMinorSchema,
    deficitMinor: unsignedMinorSchema.positive(),
    action: z.object({ type: z.literal('open_recurring') }).strict(),
  }).strict(),
])

export const aiCopilotInsightsSchema = z
  .array(aiCopilotInsightSchema)
  .max(MAX_AI_COPILOT_INSIGHTS)

export const aiCopilotInsightsResponseSchema = z
  .object({
    insights: aiCopilotInsightsSchema,
    context: aiCopilotContextCoverageSchema,
    preview: aiCopilotContextSchema,
    contextDigest: aiCopilotContextDigestSchema,
  })
  .strict()

export type AiCopilotLocale = z.infer<typeof aiCopilotLocaleSchema>
export type AiCopilotContextDigest = z.infer<typeof aiCopilotContextDigestSchema>
export type AiCopilotRequest = z.infer<typeof aiCopilotRequestSchema>
export type AiCopilotContext = z.infer<typeof aiCopilotContextSchema>
export type AiCopilotTransactionFilters = z.infer<typeof aiCopilotTransactionFiltersSchema>
export type AiCopilotOverviewReview = z.infer<typeof aiCopilotOverviewReviewSchema>
export type AiCopilotSummaryMetric = z.infer<typeof aiCopilotSummaryMetricSchema>
export type AiCopilotAttentionMetric = z.infer<typeof aiCopilotAttentionMetricSchema>
export type AiCopilotEvidenceReference = z.infer<typeof aiCopilotEvidenceReferenceSchema>
export type AiCopilotEvidence = z.infer<typeof aiCopilotEvidenceSchema>
export type AiCopilotTransactionDraftInput = z.infer<typeof aiCopilotTransactionDraftInputSchema>
export type AiCopilotRecurringRuleDraftInput = z.infer<typeof aiCopilotRecurringRuleDraftInputSchema>
export type AiCopilotModelAction = z.infer<typeof aiCopilotModelActionSchema>
export type AiCopilotModelOutput = z.infer<typeof aiCopilotModelOutputSchema>
export type AiCopilotAction = z.infer<typeof aiCopilotActionSchema>
export type AiCopilotResponse = z.infer<typeof aiCopilotResponseSchema>
export type AiCopilotInsight = z.infer<typeof aiCopilotInsightSchema>
export type AiCopilotContextCoverage = z.infer<typeof aiCopilotContextCoverageSchema>
export type AiCopilotInsightsResponse = z.infer<typeof aiCopilotInsightsResponseSchema>

export type AiCopilotContextSource = {
  month: string
  currency: Account['currency']
  summary: Pick<
    Summary,
    | 'income'
    | 'expense'
    | 'balance'
    | 'expenseByCategory'
    | 'monthlySpendingPlans'
    | 'recurringForecast'
    | 'scheduledOutlook'
  >
  accounts: Array<Pick<Account, 'id' | 'name' | 'type' | 'currency' | 'isActive'>>
  categories: Array<Pick<Category, 'id' | 'name' | 'type' | 'isActive'>>
  attention: AiCopilotContext['attention']
}

export function buildAiCopilotContext(source: AiCopilotContextSource): AiCopilotContext {
  const prepared = prepareAiCopilotContextSource(source)
  const selectedActiveAccounts = prepared.activeAccounts.slice(
    0,
    MAX_AI_COPILOT_CONTEXT_ITEMS,
  )
  const selectedActiveCategories = prepared.activeCategories.slice(
    0,
    MAX_AI_COPILOT_CONTEXT_ITEMS,
  )
  const selectedActiveExpenseCategoryIds = new Set(
    selectedActiveCategories
      .filter((category) => category.type === 'expense')
      .map((category) => category.id),
  )
  const expenseCategoryComparisons = prepared.expenseCategoryComparisons
    .filter((comparison) => selectedActiveExpenseCategoryIds.has(comparison.categoryId))
    .slice(0, MAX_AI_COPILOT_CONTEXT_ITEMS)
  const monthlySpendingPlans = prepared.monthlySpendingPlans
    .filter((plan) => selectedActiveExpenseCategoryIds.has(plan.categoryId))
    .slice(0, MAX_AI_COPILOT_CONTEXT_ITEMS)

  return aiCopilotContextSchema.parse({
    month: source.month,
    currency: source.currency,
    summary: {
      incomeMinor: source.summary.income,
      expenseMinor: source.summary.expense,
      netMinor: source.summary.balance,
    },
    expenseCategoryComparisons,
    monthlySpendingPlans,
    scheduledOutlook: prepared.scheduledOutlook,
    attention: source.attention,
    activeAccounts: selectedActiveAccounts,
    activeCategories: selectedActiveCategories,
    omissionCounts: {
      expenseCategoryComparisons: prepared.expenseCategoryComparisons.length
        - expenseCategoryComparisons.length,
      monthlySpendingPlans: prepared.monthlySpendingPlans.length - monthlySpendingPlans.length,
      activeAccounts: omittedCount(prepared.activeAccounts),
      activeCategories: omittedCount(prepared.activeCategories),
    },
  })
}

export function buildAiCopilotInsightsFromSource(
  source: AiCopilotContextSource,
): AiCopilotInsight[] {
  const prepared = prepareAiCopilotContextSource(source)
  return buildAiCopilotInsights({
    attention: source.attention,
    expenseCategoryComparisons: prepared.expenseCategoryComparisons,
    monthlySpendingPlans: prepared.monthlySpendingPlans,
    scheduledOutlook: prepared.scheduledOutlook,
  })
}

export function getAiCopilotContextCoverage(
  context: AiCopilotContext,
): AiCopilotContextCoverage {
  return aiCopilotContextCoverageSchema.parse({
    partial: Object.values(context.omissionCounts).some((count) => count > 0),
    omissionCounts: context.omissionCounts,
  })
}

type PreparedAiCopilotContextSource = Pick<
  AiCopilotContext,
  | 'activeAccounts'
  | 'activeCategories'
  | 'expenseCategoryComparisons'
  | 'monthlySpendingPlans'
  | 'scheduledOutlook'
>

function prepareAiCopilotContextSource(
  source: AiCopilotContextSource,
): PreparedAiCopilotContextSource {
  const activeAccounts = source.accounts
    .filter((account) => account.isActive)
    .toSorted((left, right) => left.id - right.id)
    .map(({ id, name, type, currency }) => ({ id, name, type, currency }))
  const activeCategories = source.categories
    .filter((category) => category.isActive)
    .toSorted((left, right) => left.id - right.id)
    .map(({ id, name, type }) => ({ id, name, type }))
  const allActiveExpenseCategories = new Map(
    activeCategories
      .filter((category) => category.type === 'expense')
      .map((category) => [category.id, category] as const),
  )
  const expenseCategoryComparisons = source.summary.expenseByCategory
    .flatMap((comparison) => {
      const category = allActiveExpenseCategories.get(comparison.categoryId)
      return category
        ? [{
            categoryId: category.id,
            categoryName: category.name,
            amountMinor: comparison.amountMinor,
            previousMonthAmountMinor: comparison.previousMonthAmountMinor ?? null,
            transactionCount: comparison.transactionCount,
          }]
        : []
    })
    .toSorted((left, right) => left.categoryId - right.categoryId)
  const monthlySpendingPlans = source.summary.monthlySpendingPlans
    .flatMap((plan) => {
      const category = allActiveExpenseCategories.get(plan.categoryId)
      return category
        ? [{
            categoryId: category.id,
            categoryName: category.name,
            plannedMinor: plan.plannedMinor,
            spentMinor: plan.spentMinor,
          }]
        : []
    })
    .toSorted((left, right) => left.categoryId - right.categoryId)
  const recurringForecast = summarizeRecurringForecast(source.summary.recurringForecast)
    ?? { incomeMinor: 0, expenseMinor: 0, netMinor: 0 }

  return {
    activeAccounts,
    activeCategories,
    expenseCategoryComparisons,
    monthlySpendingPlans,
    scheduledOutlook: {
      startOn: `${source.month}-01`,
      endOnExclusive: nextMonthStart(source.month),
      ...recurringForecast,
    },
  }
}

function omittedCount(items: readonly unknown[]) {
  return Math.max(0, items.length - MAX_AI_COPILOT_CONTEXT_ITEMS)
}

function nextMonthStart(month: string) {
  const date = new Date(`${month}-01T00:00:00.000Z`)
  date.setUTCMonth(date.getUTCMonth() + 1)
  return date.toISOString().slice(0, 10)
}

type RankedInsight = {
  insight: AiCopilotInsight
  rank: number
  magnitude: number
  tieBreaker: number
}

type AiCopilotInsightContext = Pick<
  AiCopilotContext,
  | 'attention'
  | 'expenseCategoryComparisons'
  | 'monthlySpendingPlans'
  | 'scheduledOutlook'
>

const defaultTransactionFilters = {
  transactionType: 'all',
  categoryId: null,
  importReviewStatus: 'all',
  duplicatesOnly: false,
  search: null,
} as const

export function buildAiCopilotInsights(context: AiCopilotInsightContext): AiCopilotInsight[] {
  const ranked: RankedInsight[] = []

  if (context.attention.duplicates > 0) {
    ranked.push({
      insight: {
        kind: 'duplicates',
        severity: 'attention',
        count: context.attention.duplicates,
        action: {
          type: 'show_transactions',
          filters: { ...defaultTransactionFilters, duplicatesOnly: true },
        },
      },
      rank: 500,
      magnitude: context.attention.duplicates,
      tieBreaker: 0,
    })
  }

  if (context.attention.unreviewed + context.attention.needsFollowUp > 0) {
    ranked.push({
      insight: {
        kind: 'import_attention',
        severity: context.attention.needsFollowUp > 0 ? 'warning' : 'attention',
        unreviewed: context.attention.unreviewed,
        needsFollowUp: context.attention.needsFollowUp,
        action: {
          type: 'show_transactions',
          filters: {
            ...defaultTransactionFilters,
            importReviewStatus: context.attention.needsFollowUp > 0
              ? 'needs_follow_up'
              : 'unreviewed',
          },
        },
      },
      rank: 450,
      magnitude: context.attention.needsFollowUp * 2 + context.attention.unreviewed,
      tieBreaker: 0,
    })
  }

  if (context.scheduledOutlook.netMinor < 0) {
    ranked.push({
      insight: {
        kind: 'scheduled_deficit',
        severity: 'warning',
        incomeMinor: context.scheduledOutlook.incomeMinor,
        expenseMinor: context.scheduledOutlook.expenseMinor,
        deficitMinor: -context.scheduledOutlook.netMinor,
        action: { type: 'open_recurring' },
      },
      rank: 400,
      magnitude: -context.scheduledOutlook.netMinor,
      tieBreaker: 0,
    })
  }

  for (const plan of context.monthlySpendingPlans) {
    const overByMinor = plan.spentMinor - plan.plannedMinor
    if (overByMinor <= 0) continue
    ranked.push({
      insight: {
        kind: 'over_plan',
        severity: 'warning',
        ...plan,
        overByMinor,
        action: {
          type: 'show_transactions',
          filters: {
            ...defaultTransactionFilters,
            transactionType: 'expense',
            categoryId: plan.categoryId,
          },
        },
      },
      rank: 300,
      magnitude: plan.plannedMinor === 0
        ? Number.MAX_SAFE_INTEGER
        : Math.floor(overByMinor * 10_000 / plan.plannedMinor),
      tieBreaker: plan.categoryId,
    })
  }

  for (const comparison of context.expenseCategoryComparisons) {
    const previous = comparison.previousMonthAmountMinor
    if (!previous || comparison.amountMinor <= previous) continue
    const increaseMinor = comparison.amountMinor - previous
    const increaseBasisPoints = Math.floor(increaseMinor * 10_000 / previous)
    if (
      increaseMinor < AI_COPILOT_MEANINGFUL_INCREASE_MINOR
      || increaseBasisPoints < AI_COPILOT_MEANINGFUL_INCREASE_BASIS_POINTS
    ) continue
    ranked.push({
      insight: {
        kind: 'spending_increase',
        severity: 'attention',
        categoryId: comparison.categoryId,
        categoryName: comparison.categoryName,
        amountMinor: comparison.amountMinor,
        previousMonthAmountMinor: previous,
        increaseMinor,
        increaseBasisPoints,
        action: {
          type: 'show_transactions',
          filters: {
            ...defaultTransactionFilters,
            transactionType: 'expense',
            categoryId: comparison.categoryId,
          },
        },
      },
      rank: 200,
      magnitude: increaseBasisPoints,
      tieBreaker: comparison.categoryId,
    })
  }

  return ranked
    .sort((left, right) => (
      right.rank - left.rank
      || right.magnitude - left.magnitude
      || left.tieBreaker - right.tieBreaker
    ))
    .slice(0, MAX_AI_COPILOT_INSIGHTS)
    .map(({ insight }) => insight)
}
