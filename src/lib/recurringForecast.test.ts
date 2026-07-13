import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  recurringForecastOccurrences,
  recurringForecastForMonth,
  recurringForecastPeriods,
  summarizeRecurringForecast,
  type RecurringForecastRule,
} from './recurringForecast'
import type { ScheduledRecurringSummary } from './schema'

function rule(patch: Partial<RecurringForecastRule>): RecurringForecastRule {
  return {
    id: '10000000-0000-4000-8000-000000000001',
    name: 'Monthly bill',
    type: 'expense',
    amountMinor: 8000,
    payee: 'Utility company',
    frequency: 'monthly',
    nextOccurrenceOn: '2026-01-31',
    anchorDay: 31,
    ...patch,
  }
}

function summary(
  patch: Partial<ScheduledRecurringSummary> = {},
): ScheduledRecurringSummary {
  return {
    recurringRuleId: '10000000-0000-4000-8000-000000000010',
    name: 'Scheduled item',
    type: 'expense',
    amountMinor: 100,
    payee: 'Provider',
    frequency: 'monthly',
    firstOccurrenceOn: '2026-07-01',
    occurrenceCount: 1,
    occurrenceDates: ['2026-07-01'],
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
        payee: 'Utility company',
        frequency: 'weekly',
        firstOccurrenceOn: '2026-02-02',
        occurrenceCount: 4,
        occurrenceDates: [
          '2026-02-02',
          '2026-02-09',
          '2026-02-16',
          '2026-02-23',
        ],
      },
      {
        recurringRuleId: '10000000-0000-4000-8000-000000000001',
        name: 'Monthly bill',
        type: 'expense',
        amountMinor: 8000,
        payee: 'Utility company',
        frequency: 'monthly',
        firstOccurrenceOn: '2026-02-28',
        occurrenceCount: 1,
        occurrenceDates: ['2026-02-28'],
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
      payee: 'Unsafe payee',
      frequency: 'daily',
      firstOccurrenceOn: '2026-02-01',
      occurrenceCount: 2,
      occurrenceDates: ['2026-02-01', '2026-02-02'],
    }]), null)
  })

  it('expands every rule into a stable chronological schedule', () => {
    const occurrences = recurringForecastOccurrences(recurringForecastForMonth([
      rule({
        id: '10000000-0000-4000-8000-000000000002',
        name: 'Weekly class',
        payee: 'Studio',
        amountMinor: 2500,
        frequency: 'weekly',
        nextOccurrenceOn: '2026-02-02',
        anchorDay: 2,
      }),
      rule({
        id: '10000000-0000-4000-8000-000000000003',
        name: 'Payday',
        payee: 'Employer',
        accountId: 2,
        categoryId: 1,
        type: 'income',
        amountMinor: 500000,
        nextOccurrenceOn: '2026-02-10',
        anchorDay: 10,
      }),
      rule({
        name: 'Rent',
        payee: 'Landlord',
        nextOccurrenceOn: '2026-02-10',
        anchorDay: 10,
      }),
    ], '2026-02'))

    assert.deepEqual(occurrences.map(({ name, occurrenceOn }) => ({ name, occurrenceOn })), [
      { name: 'Weekly class', occurrenceOn: '2026-02-02' },
      { name: 'Weekly class', occurrenceOn: '2026-02-09' },
      { name: 'Rent', occurrenceOn: '2026-02-10' },
      { name: 'Payday', occurrenceOn: '2026-02-10' },
      { name: 'Weekly class', occurrenceOn: '2026-02-16' },
      { name: 'Weekly class', occurrenceOn: '2026-02-23' },
    ])
    assert.deepEqual(occurrences.find(({ name }) => name === 'Payday'), {
      recurringRuleId: '10000000-0000-4000-8000-000000000003',
      name: 'Payday',
      payee: 'Employer',
      accountId: 2,
      categoryId: 1,
      type: 'income',
      amountMinor: 500000,
      frequency: 'monthly',
      occurrenceOn: '2026-02-10',
    })
  })

  it('groups exact occurrence dates into month-anchored seven-day periods', () => {
    const periods = recurringForecastPeriods('2026-07', [summary({
      occurrenceCount: 10,
      occurrenceDates: [
        '2026-07-01',
        '2026-07-07',
        '2026-07-08',
        '2026-07-14',
        '2026-07-15',
        '2026-07-21',
        '2026-07-22',
        '2026-07-28',
        '2026-07-29',
        '2026-07-31',
      ],
    })])

    assert.deepEqual(periods.map(({ startOn, endOnExclusive, totals }) => ({
      startOn,
      endOnExclusive,
      expenseMinor: totals?.expenseMinor,
    })), [
      { startOn: '2026-07-01', endOnExclusive: '2026-07-08', expenseMinor: 200 },
      { startOn: '2026-07-08', endOnExclusive: '2026-07-15', expenseMinor: 200 },
      { startOn: '2026-07-15', endOnExclusive: '2026-07-22', expenseMinor: 200 },
      { startOn: '2026-07-22', endOnExclusive: '2026-07-29', expenseMinor: 200 },
      { startOn: '2026-07-29', endOnExclusive: '2026-08-01', expenseMinor: 200 },
    ])
  })

  it('keeps February calendar boundaries and zero-fills applicable periods', () => {
    const nonLeap = recurringForecastPeriods('2026-02', [summary({
      firstOccurrenceOn: '2026-02-02',
      occurrenceDates: ['2026-02-02'],
    })])
    assert.equal(nonLeap.length, 5)
    assert.deepEqual(nonLeap.map(({ startOn, endOnExclusive }) => ({ startOn, endOnExclusive })), [
      { startOn: '2026-02-01', endOnExclusive: '2026-02-08' },
      { startOn: '2026-02-08', endOnExclusive: '2026-02-15' },
      { startOn: '2026-02-15', endOnExclusive: '2026-02-22' },
      { startOn: '2026-02-22', endOnExclusive: '2026-03-01' },
      { startOn: '2026-03-01', endOnExclusive: '2026-03-01' },
    ])
    assert.deepEqual(nonLeap.slice(1, 4).map(({ totals }) => totals), [
      { incomeMinor: 0, expenseMinor: 0, netMinor: 0 },
      { incomeMinor: 0, expenseMinor: 0, netMinor: 0 },
      { incomeMinor: 0, expenseMinor: 0, netMinor: 0 },
    ])

    const leap = recurringForecastPeriods('2024-02', [summary({
      firstOccurrenceOn: '2024-02-29',
      occurrenceDates: ['2024-02-29'],
    })])
    assert.deepEqual(leap[4], {
      index: 5,
      startOn: '2024-02-29',
      endOnExclusive: '2024-03-01',
      totals: { incomeMinor: 0, expenseMinor: 100, netMinor: -100 },
    })
  })

  it('reconciles period totals to the exact monthly forecast totals', () => {
    const forecast = [
      summary({
        recurringRuleId: '10000000-0000-4000-8000-000000000011',
        type: 'income',
        amountMinor: 1_000,
        occurrenceCount: 2,
        occurrenceDates: ['2026-07-03', '2026-07-24'],
      }),
      summary({
        recurringRuleId: '10000000-0000-4000-8000-000000000012',
        amountMinor: 125,
        occurrenceCount: 3,
        occurrenceDates: ['2026-07-08', '2026-07-15', '2026-07-29'],
      }),
    ]
    const periodTotals = recurringForecastPeriods('2026-07', forecast)
      .map(({ totals }) => totals)
      .filter((totals) => totals !== null)
      .reduce((combined, totals) => ({
        incomeMinor: combined.incomeMinor + totals.incomeMinor,
        expenseMinor: combined.expenseMinor + totals.expenseMinor,
        netMinor: combined.netMinor + totals.netMinor,
      }), { incomeMinor: 0, expenseMinor: 0, netMinor: 0 })

    assert.deepEqual(periodTotals, summarizeRecurringForecast(forecast))
  })

  it('rejects invalid month boundaries and out-of-month occurrences', () => {
    assert.throws(() => recurringForecastPeriods('2026-13', []), /valid range/)
    assert.throws(() => recurringForecastPeriods('2026-07', [summary({
      occurrenceDates: ['2026-08-01'],
    })]), /outside the selected month/)
  })

  it('withholds one period whose exact directional total is unsafe', () => {
    const periods = recurringForecastPeriods('2026-07', [
      summary({
        recurringRuleId: '10000000-0000-4000-8000-000000000013',
        amountMinor: Number.MAX_SAFE_INTEGER,
        occurrenceDates: ['2026-07-01'],
      }),
      summary({
        recurringRuleId: '10000000-0000-4000-8000-000000000014',
        amountMinor: 1,
        occurrenceDates: ['2026-07-07'],
      }),
    ])

    assert.equal(periods[0].totals, null)
    assert.deepEqual(periods[1].totals, { incomeMinor: 0, expenseMinor: 0, netMinor: 0 })
  })
})
