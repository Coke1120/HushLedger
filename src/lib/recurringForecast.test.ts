import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  recurringForecastOccurrences,
  recurringForecastForMonth,
  recurringForecastForRange,
  recurringForecastPeriods,
  recurringForecastPeriodsForRange,
  recurringTransferForecastForMonth,
  recurringTransferForecastForRange,
  recurringTransferForecastOccurrences,
  summarizeRecurringForecast,
  type RecurringForecastRule,
  type RecurringTransferForecastRule,
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
    scheduleEndsOn: null,
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

function transferRule(
  patch: Partial<RecurringTransferForecastRule> = {},
): RecurringTransferForecastRule {
  return {
    id: '20000000-0000-4000-8000-000000000001',
    name: 'Move to savings',
    amountMinor: 50_000,
    fromAccountId: 1,
    fromAccountName: 'Bank',
    fromAccountLocalizationKey: 'account.bank',
    toAccountId: 2,
    toAccountName: 'Wallet',
    toAccountLocalizationKey: 'account.wallet',
    frequency: 'monthly',
    nextOccurrenceOn: '2026-01-31',
    anchorDay: 31,
    scheduleEndsOn: null,
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

  it('includes the schedule end date and excludes every later occurrence', () => {
    assert.deepEqual(recurringForecastForMonth([
      rule({
        name: 'Finite daily plan',
        frequency: 'daily',
        nextOccurrenceOn: '2026-07-29',
        anchorDay: 29,
        scheduleEndsOn: '2026-07-30',
      }),
    ], '2026-07').map(({ firstOccurrenceOn, occurrenceDates }) => ({
      firstOccurrenceOn,
      occurrenceDates,
    })), [{
      firstOccurrenceOn: '2026-07-29',
      occurrenceDates: ['2026-07-29', '2026-07-30'],
    }])

    assert.deepEqual(recurringForecastForMonth([
      rule({
        nextOccurrenceOn: '2026-08-01',
        scheduleEndsOn: '2026-07-31',
      }),
    ], '2026-08'), [])
  })

  it('shows yearly rules only in their anchored month', () => {
    const annualRule = rule({
      name: 'Annual insurance',
      frequency: 'yearly',
      nextOccurrenceOn: '2024-02-29',
      anchorDay: 29,
    })

    assert.deepEqual(recurringForecastForMonth([annualRule], '2026-01'), [])
    assert.deepEqual(recurringForecastForMonth([annualRule], '2026-02').map((item) => ({
      frequency: item.frequency,
      occurrenceDates: item.occurrenceDates,
    })), [{
      frequency: 'yearly',
      occurrenceDates: ['2026-02-28'],
    }])
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

describe('rolling recurring forecast', () => {
  it('uses a half-open 35-day range without truncating daily or anchored schedules', () => {
    const daily = recurringForecastForRange([rule({
      name: 'Daily plan',
      frequency: 'daily',
      nextOccurrenceOn: '2026-07-14',
      anchorDay: 14,
    })], '2026-07-14', '2026-08-18')[0]
    assert.equal(daily.occurrenceCount, 35)
    assert.equal(daily.occurrenceDates[0], '2026-07-14')
    assert.equal(daily.occurrenceDates.at(-1), '2026-08-17')

    assert.deepEqual(recurringForecastForRange([
      rule({
        id: '10000000-0000-4000-8000-000000000002',
        name: 'Month end',
        nextOccurrenceOn: '2026-07-31',
        anchorDay: 31,
      }),
      rule({
        id: '10000000-0000-4000-8000-000000000003',
        name: 'Finite weekly',
        frequency: 'weekly',
        nextOccurrenceOn: '2026-07-14',
        anchorDay: 14,
        scheduleEndsOn: '2026-07-28',
      }),
      rule({
        id: '10000000-0000-4000-8000-000000000004',
        name: 'At exclusive end',
        nextOccurrenceOn: '2026-08-18',
      }),
    ], '2026-07-14', '2026-08-18').map(({ name, occurrenceDates }) => ({
      name,
      occurrenceDates,
    })), [
      {
        name: 'Finite weekly',
        occurrenceDates: ['2026-07-14', '2026-07-21', '2026-07-28'],
      },
      { name: 'Month end', occurrenceDates: ['2026-07-31'] },
    ])
  })

  it('builds five exact seven-day periods with safe transaction-only totals', () => {
    const periods = recurringForecastPeriodsForRange('2026-07-14', '2026-08-18', [
      summary({
        type: 'income',
        amountMinor: 1_000,
        firstOccurrenceOn: '2026-07-14',
        occurrenceCount: 2,
        occurrenceDates: ['2026-07-14', '2026-08-17'],
      }),
      summary({
        recurringRuleId: '10000000-0000-4000-8000-000000000011',
        amountMinor: 125,
        firstOccurrenceOn: '2026-07-20',
        occurrenceCount: 4,
        occurrenceDates: ['2026-07-20', '2026-07-21', '2026-07-28', '2026-08-04'],
      }),
    ])

    assert.deepEqual(periods, [
      {
        index: 1,
        startOn: '2026-07-14',
        endOnExclusive: '2026-07-21',
        totals: { incomeMinor: 1_000, expenseMinor: 125, netMinor: 875 },
      },
      {
        index: 2,
        startOn: '2026-07-21',
        endOnExclusive: '2026-07-28',
        totals: { incomeMinor: 0, expenseMinor: 125, netMinor: -125 },
      },
      {
        index: 3,
        startOn: '2026-07-28',
        endOnExclusive: '2026-08-04',
        totals: { incomeMinor: 0, expenseMinor: 125, netMinor: -125 },
      },
      {
        index: 4,
        startOn: '2026-08-04',
        endOnExclusive: '2026-08-11',
        totals: { incomeMinor: 0, expenseMinor: 125, netMinor: -125 },
      },
      {
        index: 5,
        startOn: '2026-08-11',
        endOnExclusive: '2026-08-18',
        totals: { incomeMinor: 1_000, expenseMinor: 0, netMinor: 1_000 },
      },
    ])

    assert.throws(
      () => recurringForecastPeriodsForRange('2026-07-14', '2026-08-17', []),
      /exact 35-day range/,
    )
    assert.equal(recurringForecastPeriodsForRange('2026-07-14', '2026-08-18', [
      summary({ amountMinor: Number.MAX_SAFE_INTEGER, occurrenceDates: ['2026-07-14'] }),
      summary({
        recurringRuleId: '10000000-0000-4000-8000-000000000012',
        amountMinor: 1,
        occurrenceDates: ['2026-07-20'],
      }),
    ])[0].totals, null)
  })

  it('keeps transfer occurrences separate and stably ordered across the range', () => {
    assert.deepEqual(recurringTransferForecastForRange([
      transferRule({
        id: '20000000-0000-4000-8000-000000000002',
        name: 'Later ID',
        frequency: 'daily',
        nextOccurrenceOn: '2026-08-16',
        anchorDay: 16,
      }),
      transferRule({
        id: '20000000-0000-4000-8000-000000000001',
        name: 'Earlier ID',
        frequency: 'daily',
        nextOccurrenceOn: '2026-08-17',
        anchorDay: 17,
        scheduleEndsOn: '2026-08-17',
      }),
    ], '2026-07-14', '2026-08-18').map(({ name, occurrenceDates }) => ({
      name,
      occurrenceDates,
    })), [
      { name: 'Later ID', occurrenceDates: ['2026-08-16', '2026-08-17'] },
      { name: 'Earlier ID', occurrenceDates: ['2026-08-17'] },
    ])
  })

  it('rejects empty, reversed, and invalid half-open ranges', () => {
    for (const [startOn, endOnExclusive] of [
      ['2026-07-14', '2026-07-14'],
      ['2026-07-15', '2026-07-14'],
      ['not-a-date', '2026-07-14'],
    ]) {
      assert.throws(
        () => recurringForecastForRange([], startOn, endOnExclusive),
        /range/,
      )
    }
  })
})

describe('scheduled-transfer forecast', () => {
  it('reuses exact cadence anchors and clips every occurrence to the selected month and inclusive end', () => {
    const forecast = recurringTransferForecastForMonth([
      transferRule({
        id: '20000000-0000-4000-8000-000000000004',
        name: 'Yearly reserve',
        frequency: 'yearly',
        nextOccurrenceOn: '2024-02-29',
        anchorDay: 29,
      }),
      transferRule({
        id: '20000000-0000-4000-8000-000000000002',
        name: 'Weekly reserve',
        frequency: 'weekly',
        nextOccurrenceOn: '2026-01-26',
        anchorDay: 26,
      }),
      transferRule({
        id: '20000000-0000-4000-8000-000000000003',
        name: 'Daily reserve',
        frequency: 'daily',
        nextOccurrenceOn: '2026-02-27',
        anchorDay: 27,
        scheduleEndsOn: '2026-02-28',
      }),
      transferRule({}),
      transferRule({
        id: '20000000-0000-4000-8000-000000000005',
        name: 'Later reserve',
        nextOccurrenceOn: '2026-03-01',
      }),
      transferRule({
        id: '20000000-0000-4000-8000-000000000006',
        name: 'Completed reserve',
        nextOccurrenceOn: '2026-02-01',
        scheduleEndsOn: '2026-01-31',
      }),
    ], '2026-02')

    assert.deepEqual(forecast.map(({ name, occurrenceDates }) => ({ name, occurrenceDates })), [
      {
        name: 'Weekly reserve',
        occurrenceDates: ['2026-02-02', '2026-02-09', '2026-02-16', '2026-02-23'],
      },
      { name: 'Daily reserve', occurrenceDates: ['2026-02-27', '2026-02-28'] },
      { name: 'Move to savings', occurrenceDates: ['2026-02-28'] },
      { name: 'Yearly reserve', occurrenceDates: ['2026-02-28'] },
    ])
  })

  it('accepts a missing cached end date and expands a stable exact-rule schedule', () => {
    const forecast = recurringTransferForecastForMonth([
      transferRule({ scheduleEndsOn: undefined }),
      transferRule({
        id: '20000000-0000-4000-8000-000000000000',
        name: 'Earlier ID',
        scheduleEndsOn: undefined,
      }),
    ], '2026-02')

    assert.deepEqual(recurringTransferForecastOccurrences(forecast), [
      {
        recurringTransferRuleId: '20000000-0000-4000-8000-000000000000',
        name: 'Earlier ID',
        amountMinor: 50_000,
        fromAccountId: 1,
        fromAccountName: 'Bank',
        fromAccountLocalizationKey: 'account.bank',
        toAccountId: 2,
        toAccountName: 'Wallet',
        toAccountLocalizationKey: 'account.wallet',
        frequency: 'monthly',
        occurrenceOn: '2026-02-28',
      },
      {
        recurringTransferRuleId: '20000000-0000-4000-8000-000000000001',
        name: 'Move to savings',
        amountMinor: 50_000,
        fromAccountId: 1,
        fromAccountName: 'Bank',
        fromAccountLocalizationKey: 'account.bank',
        toAccountId: 2,
        toAccountName: 'Wallet',
        toAccountLocalizationKey: 'account.wallet',
        frequency: 'monthly',
        occurrenceOn: '2026-02-28',
      },
    ])
  })

  it('cannot change recurring transaction totals or weekly cash-flow periods', () => {
    const recurringTransactions = recurringForecastForMonth([
      rule({ type: 'income', amountMinor: 200_000, nextOccurrenceOn: '2026-02-10' }),
      rule({
        id: '10000000-0000-4000-8000-000000000002',
        amountMinor: 75_000,
        nextOccurrenceOn: '2026-02-20',
      }),
    ], '2026-02')
    const totals = summarizeRecurringForecast(recurringTransactions)
    const periods = recurringForecastPeriods('2026-02', recurringTransactions)

    assert.equal(recurringTransferForecastForMonth([
      transferRule({ amountMinor: Number.MAX_SAFE_INTEGER }),
    ], '2026-02').length, 1)
    assert.deepEqual(summarizeRecurringForecast(recurringTransactions), totals)
    assert.deepEqual(recurringForecastPeriods('2026-02', recurringTransactions), periods)
  })
})
