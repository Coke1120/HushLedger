import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  countDueRecurringRules,
  orderRecurringRulesByUrgency,
  recurringRuleUrgency,
} from './recurringUrgency'

type Rule = {
  id: string
  isActive: boolean
  nextOccurrenceOn: string
  scheduleEndsOn: string | null
}

function rule(id: string, overrides: Partial<Rule> = {}): Rule {
  return {
    id,
    isActive: true,
    nextOccurrenceOn: '2026-07-22',
    scheduleEndsOn: null,
    ...overrides,
  }
}

describe('recurring rule urgency', () => {
  const today = '2026-07-14'

  it('classifies active rules using Hong Kong calendar dates and a seven-day lookahead', () => {
    assert.equal(recurringRuleUrgency(rule('overdue', { nextOccurrenceOn: '2026-07-13' }), today), 'overdue')
    assert.equal(recurringRuleUrgency(rule('today', { nextOccurrenceOn: today }), today), 'due_today')
    assert.equal(recurringRuleUrgency(rule('soon', { nextOccurrenceOn: '2026-07-21' }), today), 'due_soon')
    assert.equal(recurringRuleUrgency(rule('later'), today), 'active')
  })

  it('does not describe paused or completed schedules as due', () => {
    assert.equal(recurringRuleUrgency(rule('paused', {
      isActive: false,
      nextOccurrenceOn: '2026-07-01',
    }), today), 'paused')
    assert.equal(recurringRuleUrgency(rule('completed', {
      isActive: false,
      nextOccurrenceOn: '2026-07-15',
      scheduleEndsOn: '2026-07-14',
    }), today), 'completed')
  })

  it('handles the seven-day boundary across month ends', () => {
    assert.equal(recurringRuleUrgency(rule('month-end', { nextOccurrenceOn: '2026-08-04' }), '2026-07-28'), 'due_soon')
    assert.equal(recurringRuleUrgency(rule('after-window', { nextOccurrenceOn: '2026-08-05' }), '2026-07-28'), 'active')
  })

  it('orders actionable rules first without mutating equal-date input order', () => {
    const rules = [
      rule('completed', { isActive: false, nextOccurrenceOn: '2026-07-16', scheduleEndsOn: '2026-07-15' }),
      rule('later', { nextOccurrenceOn: '2026-08-01' }),
      rule('paused', { isActive: false, nextOccurrenceOn: '2026-07-01' }),
      rule('today-a', { nextOccurrenceOn: today }),
      rule('soon', { nextOccurrenceOn: '2026-07-18' }),
      rule('oldest-overdue', { nextOccurrenceOn: '2026-07-01' }),
      rule('recent-overdue', { nextOccurrenceOn: '2026-07-13' }),
      rule('today-b', { nextOccurrenceOn: today }),
    ]

    const ordered = orderRecurringRulesByUrgency(rules, today)

    assert.deepEqual(ordered.map(({ id }) => id), [
      'oldest-overdue',
      'recent-overdue',
      'today-a',
      'today-b',
      'soon',
      'later',
      'paused',
      'completed',
    ])
    assert.deepEqual(rules.map(({ id }) => id), [
      'completed',
      'later',
      'paused',
      'today-a',
      'soon',
      'oldest-overdue',
      'recent-overdue',
      'today-b',
    ])
  })

  it('counts only active occurrences that are ready to generate', () => {
    assert.equal(countDueRecurringRules([
      rule('overdue', { nextOccurrenceOn: '2026-07-13' }),
      rule('today', { nextOccurrenceOn: today }),
      rule('soon', { nextOccurrenceOn: '2026-07-15' }),
      rule('paused', { isActive: false, nextOccurrenceOn: '2026-07-01' }),
      rule('completed', { isActive: false, nextOccurrenceOn: '2026-07-15', scheduleEndsOn: today }),
    ], today), 2)
  })

  it('rejects malformed dates instead of silently misclassifying them', () => {
    assert.throws(() => recurringRuleUrgency(rule('bad'), '2026-02-30'), /valid calendar date/i)
    assert.throws(
      () => recurringRuleUrgency(rule('bad', { nextOccurrenceOn: 'not-a-date' }), today),
      /valid calendar date/i,
    )
  })
})
