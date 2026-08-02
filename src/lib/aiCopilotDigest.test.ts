import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AiCopilotContext } from './aiCopilot'
import { digestAiCopilotContext } from './aiCopilotDigest'

const context: AiCopilotContext = {
  month: '2026-08',
  currency: 'HKD',
  summary: { incomeMinor: 500_000, expenseMinor: 380_000, netMinor: 120_000 },
  expenseCategoryComparisons: [{
    categoryId: 2,
    categoryName: 'Dining',
    amountMinor: 90_000,
    previousMonthAmountMinor: 50_000,
    transactionCount: 12,
  }],
  monthlySpendingPlans: [{
    categoryId: 2,
    categoryName: 'Dining',
    plannedMinor: 60_000,
    spentMinor: 90_000,
  }],
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

describe('AI Copilot context digest', () => {
  it('is deterministic and changes with the reviewed context', async () => {
    const digest = await digestAiCopilotContext(context)

    assert.match(digest, /^[0-9a-f]{64}$/)
    assert.equal(digest, await digestAiCopilotContext({ ...context }))
    assert.notEqual(digest, await digestAiCopilotContext({
      ...context,
      summary: { ...context.summary, expenseMinor: context.summary.expenseMinor + 1 },
    }))
  })
})
