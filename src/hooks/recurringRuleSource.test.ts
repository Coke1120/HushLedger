import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { recurringRulesForLedgerSource } from './recurringRuleSource'

describe('recurring transaction rule source isolation', () => {
  it('uses live rules only while the parent ledger is live', () => {
    const liveRules = ['private recurring rule']
    const demoRules = ['demo recurring rule']

    assert.equal(recurringRulesForLedgerSource('live', liveRules, demoRules), liveRules)
    assert.equal(recurringRulesForLedgerSource('loading', liveRules, demoRules), demoRules)
    assert.equal(recurringRulesForLedgerSource('demo', liveRules, demoRules), demoRules)
    assert.equal(recurringRulesForLedgerSource('error', liveRules, demoRules), demoRules)
  })
})
