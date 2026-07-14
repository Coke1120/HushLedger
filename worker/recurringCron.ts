import type { RecurringGenerationResult } from '../src/lib/schema'
import { runDueRecurringRules } from './recurring'
import { runDueRecurringTransferRules } from './recurringTransfers'

type RecurringRunner = (
  database: D1Database,
  asOf: string,
) => Promise<RecurringGenerationResult>

type RecurringCronOptions = {
  transactions?: RecurringRunner
  transfers?: RecurringRunner
  logger?: Pick<Console, 'info' | 'error'>
}

export async function runScheduledRecurringRules(
  database: D1Database,
  asOf: string,
  options: RecurringCronOptions = {},
) {
  const logger = options.logger ?? console
  const lanes = [
    ['transactions', options.transactions ?? runDueRecurringRules],
    ['transfers', options.transfers ?? runDueRecurringTransferRules],
  ] as const
  let failed = false

  for (const [lane, run] of lanes) {
    try {
      const result = await run(database, asOf)
      logger.info('recurring_rules_run', { trigger: 'cron', lane, ...result })
    } catch {
      failed = true
      logger.error('recurring_rules_run_failed', { trigger: 'cron', lane })
    }
  }

  if (failed) throw new Error('Scheduled recurring rule generation failed')
}
