import 'server-only'

import {
  buildAiCopilotContext,
  buildAiCopilotInsightsFromSource,
  getAiCopilotContextCoverage,
  type AiCopilotContext,
  type AiCopilotContextSource,
  type AiCopilotInsightsResponse,
} from '../lib/aiCopilot'
import { transactionQuerySchema } from '../lib/schema'
import type { AiCopilotReadRepository } from './aiCopilotReadRepository'

export type AiCopilotInsightsSnapshot = Omit<
  AiCopilotInsightsResponse,
  'contextDigest'
>

export async function getAiCopilotContext(
  repository: AiCopilotReadRepository,
  month: string,
): Promise<AiCopilotContext> {
  return buildAiCopilotContext(await loadAiCopilotContextSource(repository, month))
}

async function loadAiCopilotContextSource(
  repository: AiCopilotReadRepository,
  month: string,
): Promise<AiCopilotContextSource> {
  const transactionQuery = (filters: {
    duplicates?: 'exact'
    importReviewStatus?: 'unreviewed' | 'needs_follow_up'
  }) => transactionQuerySchema.parse({ month, scope: 'month', ...filters })

  const [
    summary,
    accounts,
    categories,
    ledgerSettings,
    duplicateSummary,
    unreviewedSummary,
    followUpSummary,
  ] = await Promise.all([
    repository.getSummary(month),
    repository.listAccounts(),
    repository.listCategories(),
    repository.getLedgerCurrencySettings(),
    repository.summarizeTransactions(transactionQuery({ duplicates: 'exact' })),
    repository.summarizeTransactions(transactionQuery({ importReviewStatus: 'unreviewed' })),
    repository.summarizeTransactions(transactionQuery({ importReviewStatus: 'needs_follow_up' })),
  ])

  return {
    month,
    currency: ledgerSettings.currency,
    summary,
    accounts,
    categories,
    attention: {
      duplicates: duplicateSummary.transactionCount,
      unreviewed: unreviewedSummary.transactionCount,
      needsFollowUp: followUpSummary.transactionCount,
    },
  }
}

export async function listAiCopilotInsights(
  repository: AiCopilotReadRepository,
  month: string,
): Promise<AiCopilotInsightsSnapshot> {
  const source = await loadAiCopilotContextSource(repository, month)
  const context = buildAiCopilotContext(source)
  return {
    insights: buildAiCopilotInsightsFromSource(source),
    context: getAiCopilotContextCoverage(context),
    preview: context,
  }
}
