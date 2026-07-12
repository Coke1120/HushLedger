import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { recurringForecastForMonth, type RecurringForecastRule } from './recurringForecast'

function rule(patch: Partial<RecurringForecastRule>): RecurringForecastRule {
  return {
    id: '10000000-0000-4000-8000-000000000001',
    name: 'Monthly bill',
    type: 'expense',
    amountMinor: 8000,
    frequency: 'monthly',
    nextOccurrenceOn: '2026-01-31',
    anchorDay: 31,
    ...patch,
  }
}

describe('monthly recurring forecast', () => {
  it('preserves month-end anchors and reports only not-yet-generated occurrences', () => {
    assert.deepEqual(recurringForecastForMonth([
      rule({}),
      rule({
        id: '10000000-0000-4000-8000-000000000002',
        name: 'Weekly class',
        amountMinor: 2500,
        frequency: 'weekly',
        nextOccurrenceOn: '2026-02-02',
        anchorDay: 2,
      }),
    ], '2026-02'), [
      {
        recurringRuleId: '10000000-0000-4000-8000-000000000002',
        name: 'Weekly class',
        type: 'expense',
        amountMinor: 2500,
        frequency: 'weekly',
        firstOccurrenceOn: '2026-02-02',
        occurrenceCount: 4,
      },
      {
        recurringRuleId: '10000000-0000-4000-8000-000000000001',
        name: 'Monthly bill',
        type: 'expense',
        amountMinor: 8000,
        frequency: 'monthly',
        firstOccurrenceOn: '2026-02-28',
        occurrenceCount: 1,
      },
    ])
  })

  it('counts daily occurrences within the selected month and excludes later rules', () => {
    assert.deepEqual(recurringForecastForMonth([
      rule({
        name: 'Daily commute',
        frequency: 'daily',
        nextOccurrenceOn: '2026-07-30',
        anchorDay: 30,
      }),
      rule({
        id: '10000000-0000-4000-8000-000000000003',
        nextOccurrenceOn: '2026-08-01',
      }),
    ], '2026-07').map(({ name, firstOccurrenceOn, occurrenceCount }) => ({
      name,
      firstOccurrenceOn,
      occurrenceCount,
    })), [
      { name: 'Daily commute', firstOccurrenceOn: '2026-07-30', occurrenceCount: 2 },
    ])
  })
})
