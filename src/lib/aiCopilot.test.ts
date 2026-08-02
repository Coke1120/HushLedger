import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  MAX_AI_COPILOT_ACTIONS,
  MAX_AI_COPILOT_CONTEXT_ITEMS,
  MAX_AI_COPILOT_EVIDENCE,
  MAX_AI_COPILOT_INSIGHTS,
  aiCopilotContextSchema,
  aiCopilotInsightsResponseSchema,
  aiCopilotModelOutputSchema,
  aiCopilotRequestSchema,
  aiCopilotResponseSchema,
  buildAiCopilotContext,
  buildAiCopilotInsights,
  buildAiCopilotInsightsFromSource,
  type AiCopilotContext,
} from './aiCopilot'

const context: AiCopilotContext = {
  month: '2026-08',
  currency: 'HKD',
  summary: { incomeMinor: 500_000, expenseMinor: 380_000, netMinor: 120_000 },
  expenseCategoryComparisons: [
    {
      categoryId: 2,
      categoryName: 'Dining',
      amountMinor: 90_000,
      previousMonthAmountMinor: 50_000,
      transactionCount: 12,
    },
  ],
  monthlySpendingPlans: [
    {
      categoryId: 2,
      categoryName: 'Dining',
      plannedMinor: 60_000,
      spentMinor: 90_000,
    },
  ],
  scheduledOutlook: {
    startOn: '2026-08-01',
    endOnExclusive: '2026-09-01',
    incomeMinor: 100_000,
    expenseMinor: 150_000,
    netMinor: -50_000,
  },
  attention: { duplicates: 2, unreviewed: 3, needsFollowUp: 1 },
  activeAccounts: [{ id: 1, name: 'Wallet', type: 'wallet', currency: 'HKD' }],
  activeCategories: [{ id: 2, name: 'Dining', type: 'expense' }],
  omissionCounts: {
    expenseCategoryComparisons: 0,
    monthlySpendingPlans: 0,
    activeAccounts: 0,
    activeCategories: 0,
  },
}

const transactionInput = {
  id: '019f5087-229b-7ce3-a76f-95c833dcf251',
  type: 'expense',
  amountMinor: 1_200,
  currency: 'HKD',
  accountId: 1,
  categoryId: 2,
  occurredOn: '2026-08-01',
  payee: '',
  note: '',
  cleared: false,
}

const completeContextCoverage = {
  partial: false,
  omissionCounts: {
    expenseCategoryComparisons: 0,
    monthlySpendingPlans: 0,
    activeAccounts: 0,
    activeCategories: 0,
  },
}

const contextDigest = 'a'.repeat(64)

describe('AI Copilot contracts', () => {
  it('accepts stored provider requests and rejects invalid locale, month, and extra fields', () => {
    const request = {
      provider: { source: 'stored', expectedUpdatedAt: '2026-08-01T00:00:00.000Z' },
      locale: 'zh-Hant',
      month: '2026-08',
      expectedContextDigest: contextDigest,
      prompt: 'Where did spending increase?',
    }
    assert.equal(aiCopilotRequestSchema.safeParse(request).success, true)
    assert.equal(aiCopilotRequestSchema.safeParse({ ...request, locale: 'zh' }).success, false)
    assert.equal(aiCopilotRequestSchema.safeParse({ ...request, month: '2026-13' }).success, false)
    assert.equal(aiCopilotRequestSchema.safeParse({ ...request, expectedContextDigest: 'A'.repeat(64) }).success, false)
    assert.equal(aiCopilotRequestSchema.safeParse({ ...request, rawTransactions: [] }).success, false)
  })

  it('keeps server context bounded and excludes raw transaction details', () => {
    assert.equal(aiCopilotContextSchema.safeParse(context).success, true)
    assert.equal(aiCopilotContextSchema.safeParse({ ...context, payees: ['Secret merchant'] }).success, false)
    assert.equal(aiCopilotContextSchema.safeParse({
      ...context,
      scheduledOutlook: {
        ...context.scheduledOutlook,
        endOnExclusive: '2026-09-05',
      },
    }).success, false)
    assert.equal(aiCopilotContextSchema.safeParse({
      ...context,
      activeCategories: Array.from(
        { length: MAX_AI_COPILOT_CONTEXT_ITEMS + 1 },
        (_, index) => ({ id: index + 1, name: `Category ${index}`, type: 'expense' }),
      ),
    }).success, false)
  })

  it('minimizes, remaps, orders, and bounds selected-month provider context', () => {
    const activeExpenseCategories = Array.from(
      { length: MAX_AI_COPILOT_CONTEXT_ITEMS + 1 },
      (_, index) => ({
        id: MAX_AI_COPILOT_CONTEXT_ITEMS + 1 - index,
        name: `Current category ${MAX_AI_COPILOT_CONTEXT_ITEMS + 1 - index}`,
        type: 'expense' as const,
        isActive: true,
      }),
    )
    const sourceSummary = {
      income: 500_000,
      expense: 380_000,
      balance: 120_000,
      expenseByCategory: [
        ...activeExpenseCategories.map((category) => ({
          categoryId: category.id,
          categoryName: `Stale category ${category.id}`,
          categoryLocalizationKey: null,
          categoryIcon: 'circle',
          categoryColor: '#000000',
          amountMinor: category.id * 100,
          transactionCount: 1,
          previousMonthAmountMinor: 0,
        })),
        {
          categoryId: 999,
          categoryName: 'Inactive secret category',
          categoryLocalizationKey: null,
          categoryIcon: 'circle',
          categoryColor: '#000000',
          amountMinor: 99_900,
          transactionCount: 1,
          previousMonthAmountMinor: 0,
        },
      ],
      monthlySpendingPlans: [
        ...activeExpenseCategories.map((category) => ({
          categoryId: category.id,
          categoryName: `Stale plan ${category.id}`,
          categoryLocalizationKey: null,
          categoryIcon: 'circle',
          categoryColor: '#000000',
          plannedMinor: category.id * 50,
          spentMinor: category.id * 100,
        })),
        {
          categoryId: 999,
          categoryName: 'Inactive secret plan',
          categoryLocalizationKey: null,
          categoryIcon: 'circle',
          categoryColor: '#000000',
          plannedMinor: 1,
          spentMinor: 2,
        },
      ],
      recurringForecast: [{
        recurringRuleId: 'selected-month-rule',
        name: 'Private selected rule name',
        type: 'expense' as const,
        amountMinor: 7_500,
        payee: 'Private selected payee',
        accountId: 1,
        categoryId: 1,
        frequency: 'monthly' as const,
        firstOccurrenceOn: '2026-08-15',
        occurrenceCount: 2,
        occurrenceDates: ['2026-08-15', '2026-08-31'],
      }],
      scheduledOutlook: {
        startOn: '2026-08-20',
        endOnExclusive: '2026-09-24',
        recurringForecast: [{
          recurringRuleId: 'rolling-rule',
          name: 'Out of month secret rule',
          type: 'income' as const,
          amountMinor: 999_999,
          payee: 'Out of month secret payee',
          accountId: 1,
          categoryId: 1,
          frequency: 'monthly' as const,
          firstOccurrenceOn: '2026-09-15',
          occurrenceCount: 1,
          occurrenceDates: ['2026-09-15'],
        }],
        recurringTransferForecast: [],
      },
      expenseByPayee: [{
        payee: 'Raw payee secret',
        amountMinor: 1,
        transactionCount: 1,
      }],
      rawTransactions: [{ note: 'Raw note secret' }],
    }
    const built = buildAiCopilotContext({
      month: '2026-08',
      currency: 'HKD',
      summary: sourceSummary,
      accounts: Array.from(
        { length: MAX_AI_COPILOT_CONTEXT_ITEMS + 1 },
        (_, index) => ({
          id: MAX_AI_COPILOT_CONTEXT_ITEMS + 1 - index,
          name: `Account ${MAX_AI_COPILOT_CONTEXT_ITEMS + 1 - index}`,
          type: 'bank' as const,
          currency: 'HKD' as const,
          isActive: true,
        }),
      ),
      categories: [
        ...activeExpenseCategories,
        { id: 999, name: 'Inactive secret category', type: 'expense', isActive: false },
      ],
      attention: { duplicates: 0, unreviewed: 0, needsFollowUp: 0 },
    })

    assert.deepEqual(built.scheduledOutlook, {
      startOn: '2026-08-01',
      endOnExclusive: '2026-09-01',
      incomeMinor: 0,
      expenseMinor: 15_000,
      netMinor: -15_000,
    })
    assert.equal(built.expenseCategoryComparisons[0]?.categoryName, 'Current category 1')
    assert.equal(built.monthlySpendingPlans[0]?.categoryName, 'Current category 1')
    assert.deepEqual(built.activeAccounts.map(({ id }) => id), Array.from(
      { length: MAX_AI_COPILOT_CONTEXT_ITEMS },
      (_, index) => index + 1,
    ))
    assert.deepEqual(built.activeCategories.map(({ id }) => id), Array.from(
      { length: MAX_AI_COPILOT_CONTEXT_ITEMS },
      (_, index) => index + 1,
    ))
    const selectedCategoryIds = new Set(built.activeCategories.map(({ id }) => id))
    assert(built.expenseCategoryComparisons.every(
      ({ categoryId }) => selectedCategoryIds.has(categoryId),
    ))
    assert(built.monthlySpendingPlans.every(
      ({ categoryId }) => selectedCategoryIds.has(categoryId),
    ))
    assert.deepEqual(built.omissionCounts, {
      expenseCategoryComparisons: 1,
      monthlySpendingPlans: 1,
      activeAccounts: 1,
      activeCategories: 1,
    })
    const serialized = JSON.stringify(built)
    for (const secret of [
      'Inactive secret',
      'Stale category',
      'Stale plan',
      'Private selected rule name',
      'Private selected payee',
      'Out of month secret',
      'Raw payee secret',
      'Raw note secret',
    ]) {
      assert.equal(serialized.includes(secret), false)
    }
  })

  it('keeps local insights complete when the provider reference context is truncated', () => {
    const categories = Array.from(
      { length: MAX_AI_COPILOT_CONTEXT_ITEMS + 1 },
      (_, index) => ({
        id: index + 1,
        name: `Category ${index + 1}`,
        type: 'expense' as const,
        isActive: true,
      }),
    )
    const source = {
      month: '2026-08',
      currency: 'HKD' as const,
      summary: {
        income: 0,
        expense: 10_000,
        balance: -10_000,
        expenseByCategory: [],
        monthlySpendingPlans: [{
          categoryId: MAX_AI_COPILOT_CONTEXT_ITEMS + 1,
          categoryName: 'Stale omitted name',
          categoryLocalizationKey: null,
          categoryIcon: 'circle',
          categoryColor: '#000000',
          plannedMinor: 1_000,
          spentMinor: 10_000,
        }],
        recurringForecast: [],
      },
      accounts: [],
      categories,
      attention: { duplicates: 0, unreviewed: 0, needsFollowUp: 0 },
    }

    const providerContext = buildAiCopilotContext(source)
    assert.deepEqual(providerContext.monthlySpendingPlans, [])
    assert.equal(providerContext.omissionCounts.monthlySpendingPlans, 1)
    assert.deepEqual(
      buildAiCopilotInsightsFromSource(source).map((insight) => (
        insight.kind === 'over_plan' ? insight.categoryId : null
      )),
      [MAX_AI_COPILOT_CONTEXT_ITEMS + 1],
    )
  })

  it('rejects unknown or unsafe model actions and enforces action limits', () => {
    assert.equal(aiCopilotModelOutputSchema.safeParse({
      reply: 'Review these items.',
      actions: [{ type: 'delete_transactions' }],
      evidenceReferences: [],
    }).success, false)
    assert.equal(aiCopilotModelOutputSchema.safeParse({
      reply: 'Review these items.',
      actions: [{
        type: 'show_transactions',
        filters: {
          transactionType: 'all',
          categoryId: null,
          importReviewStatus: 'all',
          duplicatesOnly: false,
          search: null,
        },
        command: 'DELETE FROM transactions',
      }],
      evidenceReferences: [],
    }).success, false)
    assert.equal(aiCopilotModelOutputSchema.safeParse({
      reply: 'Review these items.',
      actions: Array.from({ length: MAX_AI_COPILOT_ACTIONS + 1 }, () => ({
        type: 'show_overview',
        review: 'cashFlow',
      })),
      evidenceReferences: [],
    }).success, false)
  })

  it('rejects authority fields and unknown nested model draft keys', () => {
    const modelDraft = {
      type: 'expense',
      amountMinor: 1_200,
      accountId: 1,
      categoryId: 2,
      occurredOn: '2026-08-01',
      payee: '',
      note: '',
    }
    for (const authorityField of ['id', 'currency', 'cleared', 'commit', 'autoApply', 'url', 'method']) {
      assert.equal(aiCopilotModelOutputSchema.safeParse({
        reply: 'Draft ready.',
        actions: [{
          type: 'draft_transaction',
          input: { ...modelDraft, [authorityField]: authorityField === 'cleared' ? false : 'unsafe' },
        }],
        evidenceReferences: [],
      }).success, false)
    }
    assert.equal(aiCopilotModelOutputSchema.safeParse({
      reply: 'Draft ready.',
      actions: [{
        type: 'draft_transaction',
        input: { ...modelDraft, metadata: { autoApply: true } },
      }],
      evidenceReferences: [],
    }).success, false)
  })

  it('requires a nullable first occurrence in strict recurring model drafts', () => {
    const recurringDraft = {
      name: 'Monthly lunch',
      type: 'expense',
      amountMinor: 1_200,
      accountId: 1,
      categoryId: 2,
      frequency: 'monthly',
      scheduleStartsOn: '2026-08-01',
      scheduleEndsOn: null,
      firstOccurrenceOn: null,
      payee: '',
      note: '',
    }
    assert.equal(aiCopilotModelOutputSchema.safeParse({
      reply: 'Draft ready.',
      actions: [{ type: 'draft_recurring_rule', input: recurringDraft }],
      evidenceReferences: [],
    }).success, true)
    const missingFirstOccurrence: Record<string, unknown> = { ...recurringDraft }
    delete missingFirstOccurrence.firstOccurrenceOn
    assert.equal(aiCopilotModelOutputSchema.safeParse({
      reply: 'Draft ready.',
      actions: [{ type: 'draft_recurring_rule', input: missingFirstOccurrence }],
      evidenceReferences: [],
    }).success, false)
    assert.equal(aiCopilotModelOutputSchema.safeParse({
      reply: 'Unsafe activation.',
      actions: [{
        type: 'draft_recurring_rule',
        input: { ...recurringDraft, isActive: true },
      }],
      evidenceReferences: [],
    }).success, false)
  })

  it('validates normalized draft inputs against canonical ledger schemas', () => {
    assert.equal(aiCopilotResponseSchema.safeParse({
      reply: 'Draft ready.',
      actions: [{ type: 'draft_transaction', input: transactionInput }],
      evidence: [],
      context: completeContextCoverage,
      contextDigest,
    }).success, true)
    assert.equal(aiCopilotResponseSchema.safeParse({
      reply: 'Draft ready.',
      actions: [{
        type: 'draft_transaction',
        input: { ...transactionInput, accountId: -1 },
      }],
      evidence: [],
      context: completeContextCoverage,
      contextDigest,
    }).success, false)
    assert.equal(aiCopilotResponseSchema.safeParse({
      reply: 'Draft ready.',
      actions: [{ type: 'draft_transaction', input: { ...transactionInput, admin: true } }],
      evidence: [],
      context: completeContextCoverage,
      contextDigest,
    }).success, false)
    assert.equal(aiCopilotResponseSchema.safeParse({
      reply: 'Draft ready.',
      actions: [],
      evidence: [],
      context: {
        ...completeContextCoverage,
        omissionCounts: { ...completeContextCoverage.omissionCounts, activeAccounts: 1 },
      },
      contextDigest,
    }).success, false)
  })

  it('accepts bounded identifier-only evidence references and grounded evidence', () => {
    const references = [
      { kind: 'summary', metric: 'net' },
      { kind: 'category_comparison', categoryId: 2 },
      { kind: 'monthly_plan', categoryId: 2 },
      { kind: 'scheduled_outlook' },
      { kind: 'attention', metric: 'duplicates' },
    ]
    assert.equal(aiCopilotModelOutputSchema.safeParse({
      reply: 'Grounded answer.',
      actions: [],
      evidenceReferences: references,
    }).success, true)
    assert.equal(aiCopilotModelOutputSchema.safeParse({
      reply: 'Unsafe amount.',
      actions: [],
      evidenceReferences: [{ kind: 'summary', metric: 'net', amountMinor: 123 }],
    }).success, false)
    assert.equal(aiCopilotModelOutputSchema.safeParse({
      reply: 'Too many.',
      actions: [],
      evidenceReferences: Array.from(
        { length: MAX_AI_COPILOT_EVIDENCE + 1 },
        () => ({ kind: 'scheduled_outlook' }),
      ),
    }).success, false)
    assert.equal(aiCopilotResponseSchema.safeParse({
      reply: 'Grounded answer.',
      actions: [],
      evidence: [{
        kind: 'summary',
        month: context.month,
        currency: context.currency,
        metric: 'net',
        amountMinor: context.summary.netMinor,
      }],
      context: completeContextCoverage,
      contextDigest,
    }).success, true)
  })

  it('requires insight previews to carry their exact context and digest', () => {
    assert.equal(aiCopilotInsightsResponseSchema.safeParse({
      insights: [],
      context: completeContextCoverage,
      preview: context,
      contextDigest,
    }).success, true)
    assert.equal(aiCopilotInsightsResponseSchema.safeParse({
      insights: [],
      context: completeContextCoverage,
      contextDigest,
    }).success, false)
  })
})

describe('buildAiCopilotInsights', () => {
  it('ranks attention, import, deficit, plan, and increase insights deterministically', () => {
    const expected = [
      'duplicates',
      'import_attention',
      'scheduled_deficit',
      'over_plan',
      'spending_increase',
    ]
    assert.deepEqual(buildAiCopilotInsights(context).map(({ kind }) => kind), expected)
    assert.deepEqual(buildAiCopilotInsights(context), buildAiCopilotInsights(context))
  })

  it('caps insights and deterministically ranks category ties by category ID', () => {
    const crowded: AiCopilotContext = {
      ...context,
      monthlySpendingPlans: [9, 3, 7, 1, 5, 2].map((categoryId) => ({
        categoryId,
        categoryName: `Category ${categoryId}`,
        plannedMinor: 10_000,
        spentMinor: 20_000,
      })),
      expenseCategoryComparisons: [],
    }
    const insights = buildAiCopilotInsights(crowded)
    assert.equal(insights.length, MAX_AI_COPILOT_INSIGHTS)
    assert.deepEqual(
      insights.filter((insight) => insight.kind === 'over_plan').map((insight) => insight.categoryId),
      [1, 2],
    )
  })

  it('ignores small increases, exact plans, and non-deficit outlooks', () => {
    const quiet: AiCopilotContext = {
      ...context,
      expenseCategoryComparisons: [{
        categoryId: 2,
        categoryName: 'Dining',
        amountMinor: 50_500,
        previousMonthAmountMinor: 50_000,
        transactionCount: 2,
      }],
      monthlySpendingPlans: [{
        categoryId: 2,
        categoryName: 'Dining',
        plannedMinor: 50_500,
        spentMinor: 50_500,
      }],
      scheduledOutlook: { ...context.scheduledOutlook, netMinor: 0 },
      attention: { duplicates: 0, unreviewed: 0, needsFollowUp: 0 },
    }
    assert.deepEqual(buildAiCopilotInsights(quiet), [])
  })
})
