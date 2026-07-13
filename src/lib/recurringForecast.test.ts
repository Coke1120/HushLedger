import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  recurringForecastForMonth,
  summarizeRecurringForecast,
  type RecurringForecastRule,
} from './recurringForecast'

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

  it('totals every remaining occurrence without mixing the forecast into recorded money', () => {
    const forecast = recurringForecastForMonth([
      rule({
        id: '10000000-0000-4000-8000-000000000002',
        name: 'Weekly class',
        amountMinor: 2500,
        frequency: 'weekly',
        nextOccurrenceOn: '2026-02-02',
        anchorDay: 2,
      }),
      rule({
        id: '10000000-0000-4000-8000-000000000003',
        name: 'Payday',
        type: 'income',
        amountMinor: 500000,
        nextOccurrenceOn: '2026-02-15',
        anchorDay: 15,
      }),
    ], '2026-02')

    assert.deepEqual(summarizeRecurringForecast(forecast), {
      incomeMinor: 500000,
      expenseMinor: 10000,
      netMinor: 490000,
    })
    assert.deepEqual(summarizeRecurringForecast([]), {
      incomeMinor: 0,
      expenseMinor: 0,
      netMinor: 0,
    })
  })

  it('withholds totals that cannot be represented as exact JavaScript integers', () => {
    assert.equal(summarizeRecurringForecast([{
      recurringRuleId: '10000000-0000-4000-8000-000000000004',
      name: 'Unsafe total',
      type: 'expense',
      amountMinor: Number.MAX_SAFE_INTEGER,
      frequency: 'daily',
      firstOccurrenceOn: '2026-02-01',
      occurrenceCount: 2,
    }]), null)
  })
})
