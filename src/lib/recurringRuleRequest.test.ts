import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { RecurringRule } from './schema'
import { resolveRecurringRuleRequest } from './recurringRuleRequest'

const firstRule = { id: '10000000-0000-4000-8000-000000000001' } as RecurringRule
const targetRule = { id: '10000000-0000-4000-8000-000000000002' } as RecurringRule

describe('forecast recurring-rule requests', () => {
  it('waits for live rules and any existing editor before consuming the request', () => {
    assert.equal(resolveRecurringRuleRequest(targetRule.id, [], false, true, true), undefined)
    assert.equal(resolveRecurringRuleRequest(targetRule.id, [], true, false, true), undefined)
  })

  it('opens only the exact mutable rule and safely consumes stale or read-only requests', () => {
    const rules = [firstRule, targetRule]

    assert.equal(resolveRecurringRuleRequest(targetRule.id, rules, true, true, true), targetRule)
    assert.equal(resolveRecurringRuleRequest('10000000-0000-4000-8000-000000000099', rules, true, true, true), null)
    assert.equal(resolveRecurringRuleRequest(targetRule.id, rules, true, true, false), null)
  })
})
