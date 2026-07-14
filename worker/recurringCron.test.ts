import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { RecurringGenerationResult } from '../src/lib/schema'
import { runScheduledRecurringRules } from './recurringCron'

const result: RecurringGenerationResult = {
  asOf: '2026-07-14',
  scanned: 1,
  created: 1,
  alreadyExisting: 0,
  blocked: 0,
  truncated: 0,
  failed: 0,
}

describe('scheduled recurring lanes', () => {
  it('reports both successful lanes with generic operational metadata', async () => {
    const calls: string[] = []
    const logs: unknown[][] = []

    await runScheduledRecurringRules({} as D1Database, result.asOf, {
      transactions: async () => {
        calls.push('transactions')
        return result
      },
      transfers: async () => {
        calls.push('transfers')
        return result
      },
      logger: {
        info: (...values) => logs.push(values),
        error: () => assert.fail('No failure log expected'),
      },
    })

    assert.deepEqual(calls, ['transactions', 'transfers'])
    assert.deepEqual(logs.map(([, metadata]) => metadata), [
      { trigger: 'cron', lane: 'transactions', ...result },
      { trigger: 'cron', lane: 'transfers', ...result },
    ])
  })

  it('attempts the transfer lane, logs no thrown details, then rejects generically', async () => {
    const calls: string[] = []
    const logs: unknown[][] = []
    const privateFailure = 'account 42 failed for private note salary'

    await assert.rejects(
      runScheduledRecurringRules({} as D1Database, result.asOf, {
        transactions: async () => {
          calls.push('transactions')
          throw new Error(privateFailure)
        },
        transfers: async () => {
          calls.push('transfers')
          return result
        },
        logger: {
          info: (...values) => logs.push(values),
          error: (...values) => logs.push(values),
        },
      }),
      (error: Error) => {
        assert.equal(error.message, 'Scheduled recurring rule generation failed')
        assert.doesNotMatch(error.message, /account|salary|42/)
        return true
      },
    )

    assert.deepEqual(calls, ['transactions', 'transfers'])
    assert.equal(JSON.stringify(logs).includes(privateFailure), false)
    assert.deepEqual(logs[0], [
      'recurring_rules_run_failed',
      { trigger: 'cron', lane: 'transactions' },
    ])
    assert.deepEqual(logs[1], [
      'recurring_rules_run',
      { trigger: 'cron', lane: 'transfers', ...result },
    ])
  })
})
