import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  recurringRuleReviewDataIsFresh,
  recurringRulesForLedgerSource,
  refreshRecurringRulesOnActivation,
} from './recurringRuleSource'

describe('recurring transaction rule source isolation', () => {
  it('uses live rules only while the parent ledger is live', () => {
    const liveRules = ['private recurring rule']
    const demoRules = ['demo recurring rule']

    assert.equal(recurringRulesForLedgerSource('live', liveRules, demoRules), liveRules)
    assert.equal(recurringRulesForLedgerSource('loading', liveRules, demoRules), demoRules)
    assert.equal(recurringRulesForLedgerSource('demo', liveRules, demoRules), demoRules)
    assert.equal(recurringRulesForLedgerSource('error', liveRules, demoRules), demoRules)
  })

  it('hides stale generated amounts while an activation refresh is pending or fails', () => {
    let active = true
    let source: 'loading' | 'live' | 'error' = 'live'
    let refreshRequested = false

    active = refreshRecurringRulesOnActivation(active, false, () => {
      source = 'loading'
    }, () => undefined)
    assert.equal(source, 'live')

    assert.equal(recurringRuleReviewDataIsFresh(source, active, true), false)
    active = refreshRecurringRulesOnActivation(active, true, () => {
      source = 'loading'
    }, () => {
      refreshRequested = true
    })

    assert.equal(source, 'loading')
    assert.equal(refreshRequested, true)
    assert.equal(recurringRuleReviewDataIsFresh(source, active, true), false)

    source = 'error'
    assert.equal(source, 'error')
    assert.equal(recurringRuleReviewDataIsFresh(source, active, true), false)
  })
})
