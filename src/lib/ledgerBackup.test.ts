import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  LEDGER_BACKUP_FORMAT,
  LEDGER_BACKUP_VERSION,
  LEGACY_LEDGER_SCHEMA_VERSION,
  LEDGER_SCHEMA_VERSION,
  PRE_MONTHLY_PLAN_LEDGER_SCHEMA_VERSION,
  PRE_OPENING_BALANCE_LEDGER_SCHEMA_VERSION,
  PRE_CURRENCY_LEDGER_SCHEMA_VERSION,
  PRE_RECURRING_TRANSFERS_LEDGER_SCHEMA_VERSION,
  PRE_SCHEDULE_END_LEDGER_SCHEMA_VERSION,
  PRE_YEARLY_RECURRING_LEDGER_SCHEMA_VERSION,
  PRE_TRANSFERS_LEDGER_SCHEMA_VERSION,
  PREVIOUS_LEDGER_SCHEMA_VERSION,
  canonicalJson,
  checksumLedgerBackupPayload,
  compatibleLedgerBackupSchema,
  countLedgerData,
  digestLedgerData,
  ledgerBackupExportRequestSchema,
  ledgerBackupAccountTransferSchema,
  ledgerBackupRecurringRuleSchema,
  ledgerBackupRecurringTransferRuleSchema,
  ledgerBackupTransactionSchema,
  ledgerRestorePreviewSchema,
  upgradeLedgerBackupData,
  validateLedgerDataRelations,
  type LedgerBackupData,
  type LedgerBackupPayload,
} from './ledgerBackup'

const timestamp = '2026-07-13T00:00:00.000Z'

function ledgerData(): LedgerBackupData {
  return {
    currency: 'HKD',
    accounts: [
      {
        id: 1,
        name: 'Daily account',
        type: 'bank',
        currency: 'HKD',
        isActive: true,
        sortOrder: 10,
        localizationKey: 'account.bank',
        openingBalanceMinor: 125_000,
        openingBalanceOn: '2026-07-01',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: 2,
        name: 'Cash wallet',
        type: 'cash',
        currency: 'HKD',
        isActive: true,
        sortOrder: 20,
        localizationKey: 'account.cash',
        openingBalanceMinor: null,
        openingBalanceOn: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    categories: [
      {
        id: 1,
        name: 'Food',
        type: 'expense',
        icon: 'utensils',
        color: '#C16B4B',
        isActive: true,
        sortOrder: 10,
        localizationKey: 'category.food',
        monthlyPlanMinor: 50_000,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: 2,
        name: 'Salary',
        type: 'income',
        icon: 'banknote',
        color: '#2F766D',
        isActive: true,
        sortOrder: 10,
        localizationKey: 'category.salary',
        monthlyPlanMinor: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    recurringRules: [{
      id: '20000000-0000-4000-8000-000000000001',
      name: 'Lunch',
      type: 'expense',
      amountMinor: 1_000,
      currency: 'HKD',
      accountId: 1,
      categoryId: 1,
      frequency: 'daily',
      scheduleStartsOn: '2026-07-01',
      scheduleEndsOn: '2026-07-31',
      nextOccurrenceOn: '2026-07-14',
      lastOccurrenceOn: '2026-07-13',
      anchorDay: 1,
      isActive: true,
      payee: 'Cafe',
      note: '',
      generatedCount: 1,
      lastErrorCode: null,
      lastErrorAt: null,
      revision: 1,
      cursorVersion: 2,
      deletedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
    recurringTransferRules: [{
      id: '40000000-0000-4000-8000-000000000001',
      name: 'Future savings',
      amountMinor: 30_000,
      currency: 'HKD',
      fromAccountId: 2,
      toAccountId: 1,
      frequency: 'monthly',
      scheduleStartsOn: '2026-07-13',
      scheduleEndsOn: '2026-12-13',
      nextOccurrenceOn: '2026-08-13',
      lastOccurrenceOn: '2026-07-13',
      anchorDay: 13,
      isActive: true,
      note: 'Renamed after the first transfer',
      generatedCount: 1,
      lastErrorCode: null,
      lastErrorAt: null,
      revision: 2,
      cursorVersion: 2,
      deletedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
    transactions: [{
      id: '10000000-0000-4000-8000-000000000001',
      type: 'expense',
      amountMinor: 1_000,
      currency: 'HKD',
      accountId: 1,
      categoryId: 1,
      occurredOn: '2026-07-13',
      cleared: false,
      payee: 'Cafe',
      note: '',
      recurringRuleId: '20000000-0000-4000-8000-000000000001',
      recurringRuleName: 'Lunch',
      recurrenceDueOn: '2026-07-13',
      recurringOccurrenceKey: '20000000-0000-4000-8000-000000000001:2026-07-13',
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
    accountTransfers: [{
      id: '30000000-0000-4000-8000-000000000001',
      amountMinor: 25_000,
      currency: 'HKD',
      fromAccountId: 1,
      toAccountId: 2,
      occurredOn: '2026-07-14',
      fromCleared: true,
      toCleared: false,
      note: 'Cash withdrawal',
      recurringTransferRuleId: '40000000-0000-4000-8000-000000000001',
      recurringTransferRuleName: 'Automatic savings',
      recurrenceDueOn: '2026-07-13',
      recurringOccurrenceKey: '40000000-0000-4000-8000-000000000001:2026-07-13',
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
    emergencyFundGoals: [{
      id: 1,
      accountId: 1,
      targetMinor: 1_000_000,
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
    transactionImportKeys: [{
      importKey: 'csv:hushledger:id:10000000-0000-4000-8000-000000000099',
      transactionId: '10000000-0000-4000-8000-000000000099',
      importedAt: timestamp,
    }],
  }
}

function ledgerDataBeforeRecurringTransfers(data: LedgerBackupData) {
  return {
    currency: data.currency,
    accounts: data.accounts,
    categories: data.categories,
    recurringRules: data.recurringRules,
    transactions: data.transactions,
    accountTransfers: data.accountTransfers.map(({
      recurringTransferRuleId: _recurringTransferRuleId,
      recurringTransferRuleName: _recurringTransferRuleName,
      recurrenceDueOn: _recurrenceDueOn,
      recurringOccurrenceKey: _recurringOccurrenceKey,
      ...transfer
    }) => transfer),
    emergencyFundGoals: data.emergencyFundGoals,
    transactionImportKeys: data.transactionImportKeys,
  }
}

function ledgerDataBeforeScheduleEnd(data: LedgerBackupData) {
  const beforeRecurringTransfers = ledgerDataBeforeRecurringTransfers(data)
  return {
    ...beforeRecurringTransfers,
    recurringRules: beforeRecurringTransfers.recurringRules.map(({
      scheduleEndsOn: _scheduleEndsOn,
      ...rule
    }) => rule),
  }
}

function assertNoInventedRecurringTransfers(data: LedgerBackupData, expectedTransfers: number) {
  assert.deepEqual(data.recurringTransferRules, [])
  assert.equal(data.accountTransfers.length, expectedTransfers)
  data.accountTransfers.forEach((transfer) => {
    assert.equal(transfer.recurringTransferRuleId, null)
    assert.equal(transfer.recurringTransferRuleName, null)
    assert.equal(transfer.recurrenceDueOn, null)
    assert.equal(transfer.recurringOccurrenceKey, null)
  })
}

function ledgerDataBeforeYearly(data: LedgerBackupData) {
  const beforeScheduleEnd = ledgerDataBeforeScheduleEnd(data)
  return {
    ...beforeScheduleEnd,
    recurringRules: beforeScheduleEnd.recurringRules.map((rule) => {
      if (rule.frequency === 'yearly') throw new Error('Expected a pre-yearly recurring rule')
      return { ...rule, frequency: rule.frequency }
    }),
  }
}

function ledgerDataBeforeCurrency(data: LedgerBackupData) {
  const beforeYearly = ledgerDataBeforeYearly(data)
  return {
    accounts: beforeYearly.accounts,
    categories: beforeYearly.categories,
    recurringRules: beforeYearly.recurringRules,
    transactions: beforeYearly.transactions,
    accountTransfers: beforeYearly.accountTransfers,
    emergencyFundGoals: beforeYearly.emergencyFundGoals,
    transactionImportKeys: beforeYearly.transactionImportKeys,
  }
}

function ledgerDataBeforeEmergencyFund(data: LedgerBackupData) {
  const beforeYearly = ledgerDataBeforeYearly(data)
  return {
    accounts: beforeYearly.accounts,
    categories: beforeYearly.categories,
    recurringRules: beforeYearly.recurringRules,
    transactions: beforeYearly.transactions,
    accountTransfers: beforeYearly.accountTransfers,
    transactionImportKeys: beforeYearly.transactionImportKeys,
  }
}

function ledgerDataBeforeOpeningBalances(data: LedgerBackupData) {
  const beforeEmergencyFund = ledgerDataBeforeEmergencyFund(data)
  return {
    ...beforeEmergencyFund,
    accounts: beforeEmergencyFund.accounts.map(({
      openingBalanceMinor: _openingBalanceMinor,
      openingBalanceOn: _openingBalanceOn,
      ...account
    }) => account),
  }
}

function ledgerDataWithoutTransfers(data: LedgerBackupData) {
  const beforeOpening = ledgerDataBeforeOpeningBalances(data)
  return {
    accounts: beforeOpening.accounts,
    categories: beforeOpening.categories,
    recurringRules: beforeOpening.recurringRules,
    transactions: beforeOpening.transactions,
    transactionImportKeys: beforeOpening.transactionImportKeys,
  }
}

describe('ledger backups', () => {
  it('requires an explicit and strict export request', () => {
    assert.deepEqual(
      ledgerBackupExportRequestSchema.parse({ mode: 'export' }),
      { mode: 'export' },
    )
    assert.equal(ledgerBackupExportRequestSchema.safeParse({}).success, false)
    assert.equal(
      ledgerBackupExportRequestSchema.safeParse({ mode: 'export', redirect: true }).success,
      false,
    )
  })

  it('hashes canonical content independently of object property order', async () => {
    assert.equal(
      canonicalJson({ beta: 2, alpha: { delta: 4, charlie: 3 } }),
      canonicalJson({ alpha: { charlie: 3, delta: 4 }, beta: 2 }),
    )

    const payload: LedgerBackupPayload = {
      format: LEDGER_BACKUP_FORMAT,
      version: LEDGER_BACKUP_VERSION,
      exportedAt: timestamp,
      schemaVersion: LEDGER_SCHEMA_VERSION,
      data: ledgerData(),
    }
    const checksum = await checksumLedgerBackupPayload(payload)
    assert.match(checksum, /^[0-9a-f]{64}$/)
    assert.notEqual(
      checksum,
      await checksumLedgerBackupPayload({
        ...payload,
        data: {
          ...payload.data,
          transactions: [{ ...payload.data.transactions[0], amountMinor: 1_001 }],
        },
      }),
    )
  })

  it('requires both supported currencies in the restore preview contract', () => {
    const counts = {
      accounts: 2,
      categories: 2,
      recurringRules: 1,
      recurringTransferRules: 1,
      transactions: 1,
      accountTransfers: 1,
      emergencyFundGoals: 1,
      transactionImportKeys: 1,
    }
    const preview = {
      exportedAt: timestamp,
      checksum: 'a'.repeat(64),
      backupDigest: 'b'.repeat(64),
      currentDigest: 'c'.repeat(64),
      currentRevision: 1,
      currentCurrency: 'USD',
      backupCurrency: 'HKD',
      currentCounts: counts,
      backupCounts: counts,
      restoreStatements: 8,
    }

    assert.deepEqual(ledgerRestorePreviewSchema.parse(preview), preview)
    assert.equal(ledgerRestorePreviewSchema.safeParse({
      ...preview,
      backupCurrency: 'XYZ',
    }).success, false)
    const missingBackupCurrency: Record<string, unknown> = { ...preview }
    delete missingBackupCurrency.backupCurrency
    assert.equal(ledgerRestorePreviewSchema.safeParse(missingBackupCurrency).success, false)
  })

  it('accepts a complete ledger and counts every restorable table', async () => {
    const data = ledgerData()
    assert.deepEqual(validateLedgerDataRelations(data), [])
    assert.deepEqual(countLedgerData(data), {
      accounts: 2,
      categories: 2,
      recurringRules: 1,
      recurringTransferRules: 1,
      transactions: 1,
      accountTransfers: 1,
      emergencyFundGoals: 1,
      transactionImportKeys: 1,
    })
    assert.match(await digestLedgerData(data), /^[0-9a-f]{64}$/)
  })

  it('keeps the selected supported currency portable with the ledger', () => {
    const data = ledgerData()
    data.currency = 'USD'
    data.accounts.forEach((row) => { row.currency = 'USD' })
    data.recurringRules.forEach((row) => { row.currency = 'USD' })
    data.recurringTransferRules.forEach((row) => { row.currency = 'USD' })
    data.transactions.forEach((row) => { row.currency = 'USD' })
    data.accountTransfers.forEach((row) => { row.currency = 'USD' })

    assert.deepEqual(validateLedgerDataRelations(data), [])
  })

  it('preserves an optional inclusive recurring schedule end', () => {
    const rule = ledgerData().recurringRules[0]

    assert.equal(ledgerBackupRecurringRuleSchema.safeParse(rule).success, true)
    assert.equal(ledgerBackupRecurringRuleSchema.safeParse({ ...rule, scheduleEndsOn: null }).success, true)
    assert.equal(ledgerBackupRecurringRuleSchema.safeParse({
      ...rule,
      scheduleEndsOn: '2026-06-30',
    }).success, false)
    assert.equal(ledgerBackupRecurringRuleSchema.safeParse({
      ...rule,
      scheduleEndsOn: '2026-07-13',
    }).success, false)
    assert.equal(ledgerBackupRecurringRuleSchema.safeParse({
      ...rule,
      scheduleEndsOn: '2026-07-13',
      isActive: false,
    }).success, true)

    const backup = compatibleLedgerBackupSchema.parse({
      format: LEDGER_BACKUP_FORMAT,
      version: LEDGER_BACKUP_VERSION,
      exportedAt: timestamp,
      schemaVersion: LEDGER_SCHEMA_VERSION,
      data: ledgerData(),
      checksum: { algorithm: 'SHA-256', digest: 'a'.repeat(64) },
    })
    assert.equal(upgradeLedgerBackupData(backup).recurringRules[0]?.scheduleEndsOn, '2026-07-31')
  })

  it('validates recurring transfer rules and immutable occurrence provenance independently', () => {
    const data = ledgerData()
    const rule = data.recurringTransferRules[0]
    const transfer = data.accountTransfers[0]

    assert.equal(ledgerBackupRecurringTransferRuleSchema.safeParse(rule).success, true)
    assert.equal(ledgerBackupAccountTransferSchema.safeParse(transfer).success, true)
    assert.notEqual(transfer.occurredOn, transfer.recurrenceDueOn)
    assert.notEqual(rule.name, transfer.recurringTransferRuleName)
    assert.notEqual(rule.amountMinor, transfer.amountMinor)
    assert.notEqual(rule.fromAccountId, transfer.fromAccountId)
    assert.deepEqual(validateLedgerDataRelations(data), [])
    assert.equal(ledgerBackupAccountTransferSchema.safeParse({
      ...transfer,
      recurringTransferRuleName: null,
    }).success, false)
    assert.equal(ledgerBackupAccountTransferSchema.safeParse({
      ...transfer,
      recurringOccurrenceKey: `${transfer.recurringTransferRuleId}:2026-07-12`,
    }).success, false)
    assert.equal(ledgerBackupRecurringTransferRuleSchema.safeParse({
      ...rule,
      nextOccurrenceOn: '2027-01-13',
    }).success, false)
    assert.equal(ledgerBackupRecurringTransferRuleSchema.safeParse({
      ...rule,
      isActive: false,
    }).success, true)
    assert.equal(ledgerBackupRecurringTransferRuleSchema.safeParse({
      ...rule,
      nextOccurrenceOn: '2027-01-13',
      isActive: false,
    }).success, true)
    assert.equal(ledgerBackupRecurringTransferRuleSchema.safeParse({
      ...rule,
      isActive: false,
      deletedAt: timestamp,
    }).success, true)
  })

  it('upgrades schema 16 without inventing transfer rules or provenance', async () => {
    const current = ledgerData()
    const previousData = ledgerDataBeforeRecurringTransfers(current)
    const previousPayload = {
      format: LEDGER_BACKUP_FORMAT,
      version: LEDGER_BACKUP_VERSION,
      exportedAt: timestamp,
      schemaVersion: PRE_RECURRING_TRANSFERS_LEDGER_SCHEMA_VERSION,
      data: previousData,
    } as const
    const backup = compatibleLedgerBackupSchema.parse({
      ...previousPayload,
      checksum: {
        algorithm: 'SHA-256',
        digest: await checksumLedgerBackupPayload(previousPayload),
      },
    })

    const upgraded = upgradeLedgerBackupData(backup)
    assertNoInventedRecurringTransfers(upgraded, 1)
    assert.equal(upgraded.accountTransfers[0]?.fromCleared, true)
    assert.equal(upgraded.accountTransfers[0]?.toCleared, false)
    assert.equal(upgraded.accountTransfers[0]?.note, 'Cash withdrawal')
  })

  it('upgrades schema 15 recurring rules as perpetual without changing yearly schedules', async () => {
    const current = ledgerData()
    current.recurringRules[0].frequency = 'yearly'
    const previousData = ledgerDataBeforeScheduleEnd(current)
    const previousPayload = {
      format: LEDGER_BACKUP_FORMAT,
      version: LEDGER_BACKUP_VERSION,
      exportedAt: timestamp,
      schemaVersion: PRE_SCHEDULE_END_LEDGER_SCHEMA_VERSION,
      data: previousData,
    } as const
    const backup = compatibleLedgerBackupSchema.parse({
      ...previousPayload,
      checksum: {
        algorithm: 'SHA-256',
        digest: await checksumLedgerBackupPayload(previousPayload),
      },
    })

    const upgraded = upgradeLedgerBackupData(backup)
    assert.equal(upgraded.recurringRules[0]?.frequency, 'yearly')
    assert.equal(upgraded.recurringRules[0]?.scheduleEndsOn, null)
    assertNoInventedRecurringTransfers(upgraded, 1)
  })

  it('upgrades schema 14 backups without changing their currency or recurring rules', async () => {
    const previousData = ledgerDataBeforeYearly(ledgerData())
    previousData.currency = 'USD'
    previousData.accounts.forEach((row) => { row.currency = 'USD' })
    previousData.recurringRules.forEach((row) => { row.currency = 'USD' })
    previousData.transactions.forEach((row) => { row.currency = 'USD' })
    previousData.accountTransfers.forEach((row) => { row.currency = 'USD' })
    const previousPayload = {
      format: LEDGER_BACKUP_FORMAT,
      version: LEDGER_BACKUP_VERSION,
      exportedAt: timestamp,
      schemaVersion: PRE_YEARLY_RECURRING_LEDGER_SCHEMA_VERSION,
      data: previousData,
    } as const
    const backup = compatibleLedgerBackupSchema.parse({
      ...previousPayload,
      checksum: {
        algorithm: 'SHA-256',
        digest: await checksumLedgerBackupPayload(previousPayload),
      },
    })

    const upgraded = upgradeLedgerBackupData(backup)
    assert.equal(upgraded.currency, 'USD')
    assert.equal(upgraded.recurringRules[0]?.frequency, 'daily')
    assert.equal(upgraded.recurringRules[0]?.scheduleEndsOn, null)
    assertNoInventedRecurringTransfers(upgraded, 1)
  })

  it('keeps yearly rules in current backups without accepting them as schemas 8 through 14', () => {
    const data = ledgerData()
    data.recurringRules[0].frequency = 'yearly'
    const backup = {
      format: LEDGER_BACKUP_FORMAT,
      version: LEDGER_BACKUP_VERSION,
      exportedAt: timestamp,
      schemaVersion: LEDGER_SCHEMA_VERSION,
      data,
      checksum: { algorithm: 'SHA-256', digest: 'a'.repeat(64) },
    } as const

    assert.equal(compatibleLedgerBackupSchema.safeParse(backup).success, true)

    const current = ledgerData()
    const beforeYearly = ledgerDataBeforeYearly(current)
    const beforeTransfers = ledgerDataWithoutTransfers(current)
    const beforeMonthlyPlans = {
      ...beforeTransfers,
      categories: beforeTransfers.categories.map(({
        monthlyPlanMinor: _monthlyPlanMinor,
        ...category
      }) => category),
    }
    const legacy = {
      ...beforeMonthlyPlans,
      transactions: beforeMonthlyPlans.transactions.map(({
        cleared: _cleared,
        ...transaction
      }) => transaction),
    }
    const oldVersions = [
      [PRE_YEARLY_RECURRING_LEDGER_SCHEMA_VERSION, beforeYearly],
      [PRE_CURRENCY_LEDGER_SCHEMA_VERSION, ledgerDataBeforeCurrency(current)],
      [PREVIOUS_LEDGER_SCHEMA_VERSION, ledgerDataBeforeEmergencyFund(current)],
      [PRE_OPENING_BALANCE_LEDGER_SCHEMA_VERSION, ledgerDataBeforeOpeningBalances(current)],
      [PRE_TRANSFERS_LEDGER_SCHEMA_VERSION, beforeTransfers],
      [PRE_MONTHLY_PLAN_LEDGER_SCHEMA_VERSION, beforeMonthlyPlans],
      [LEGACY_LEDGER_SCHEMA_VERSION, legacy],
    ] as const

    for (const [schemaVersion, oldData] of oldVersions) {
      assert.equal(compatibleLedgerBackupSchema.safeParse({
        ...backup,
        schemaVersion,
        data: {
          ...oldData,
          recurringRules: oldData.recurringRules.map((rule) => ({
            ...rule,
            frequency: 'yearly',
          })),
        },
      }).success, false, `schema ${schemaVersion} should reject yearly`)
    }
  })

  it('upgrades schema 13 backups as HKD without dropping the emergency fund goal', async () => {
    const previousData = ledgerDataBeforeCurrency(ledgerData())
    const previousPayload = {
      format: LEDGER_BACKUP_FORMAT,
      version: LEDGER_BACKUP_VERSION,
      exportedAt: timestamp,
      schemaVersion: PRE_CURRENCY_LEDGER_SCHEMA_VERSION,
      data: previousData,
    } as const
    const backup = compatibleLedgerBackupSchema.parse({
      ...previousPayload,
      checksum: {
        algorithm: 'SHA-256',
        digest: await checksumLedgerBackupPayload(previousPayload),
      },
    })

    const upgraded = upgradeLedgerBackupData(backup)
    assert.equal(upgraded.currency, 'HKD')
    assert.deepEqual(upgraded.emergencyFundGoals, previousData.emergencyFundGoals)
    assert.equal(upgraded.accountTransfers.length, 1)
    assertNoInventedRecurringTransfers(upgraded, 1)
  })

  it('upgrades schema 12 backups without inventing an emergency fund goal', async () => {
    const current = ledgerData()
    const previousData = ledgerDataBeforeEmergencyFund(current)
    const previousPayload = {
      format: LEDGER_BACKUP_FORMAT,
      version: LEDGER_BACKUP_VERSION,
      exportedAt: timestamp,
      schemaVersion: PREVIOUS_LEDGER_SCHEMA_VERSION,
      data: previousData,
    } as const
    const backup = compatibleLedgerBackupSchema.parse({
      ...previousPayload,
      checksum: {
        algorithm: 'SHA-256',
        digest: await checksumLedgerBackupPayload(previousPayload),
      },
    })

    const upgraded = upgradeLedgerBackupData(backup)
    assert.equal(upgraded.currency, 'HKD')
    assert.deepEqual(upgraded.emergencyFundGoals, [])
    assert.equal(upgraded.accountTransfers.length, 1)
    assert.equal(upgraded.accounts[0]?.openingBalanceMinor, 125_000)
    assertNoInventedRecurringTransfers(upgraded, 1)
  })

  it('upgrades schema 11 backups without inventing opening balances or a goal', async () => {
    const current = ledgerData()
    const previousData = ledgerDataBeforeOpeningBalances(current)
    const previousPayload = {
      format: LEDGER_BACKUP_FORMAT,
      version: LEDGER_BACKUP_VERSION,
      exportedAt: timestamp,
      schemaVersion: PRE_OPENING_BALANCE_LEDGER_SCHEMA_VERSION,
      data: previousData,
    } as const
    const backup = compatibleLedgerBackupSchema.parse({
      ...previousPayload,
      checksum: {
        algorithm: 'SHA-256',
        digest: await checksumLedgerBackupPayload(previousPayload),
      },
    })

    const upgraded = upgradeLedgerBackupData(backup)
    assert.equal(upgraded.currency, 'HKD')
    assert.deepEqual(upgraded.emergencyFundGoals, [])
    assert.equal(upgraded.accountTransfers.length, 1)
    assert.equal(upgraded.accounts[0]?.openingBalanceMinor, null)
    assert.equal(upgraded.accounts[0]?.openingBalanceOn, null)
    assert.equal(upgraded.categories[0]?.monthlyPlanMinor, 50_000)
    assert.equal(upgraded.transactions[0]?.cleared, false)
    assertNoInventedRecurringTransfers(upgraded, 1)
  })

  it('upgrades schema 10 backups without inventing transfers or opening balances', async () => {
    const current = ledgerData()
    const previousData = ledgerDataWithoutTransfers(current)
    const previousPayload = {
      format: LEDGER_BACKUP_FORMAT,
      version: LEDGER_BACKUP_VERSION,
      exportedAt: timestamp,
      schemaVersion: PRE_TRANSFERS_LEDGER_SCHEMA_VERSION,
      data: previousData,
    } as const
    const backup = compatibleLedgerBackupSchema.parse({
      ...previousPayload,
      checksum: {
        algorithm: 'SHA-256',
        digest: await checksumLedgerBackupPayload(previousPayload),
      },
    })

    const upgraded = upgradeLedgerBackupData(backup)
    assert.equal(upgraded.currency, 'HKD')
    assert.deepEqual(upgraded.emergencyFundGoals, [])
    assert.deepEqual(upgraded.accountTransfers, [])
    assert.equal(upgraded.accounts[0]?.openingBalanceMinor, null)
    assert.equal(upgraded.categories[0]?.monthlyPlanMinor, 50_000)
    assert.equal(upgraded.transactions[0]?.cleared, false)
    assertNoInventedRecurringTransfers(upgraded, 0)
  })

  it('upgrades schema 9 backups without inventing category plans or transfers', async () => {
    const current = ledgerData()
    const withoutTransfers = ledgerDataWithoutTransfers(current)
    const legacyData = {
      ...withoutTransfers,
      categories: current.categories.map(({ monthlyPlanMinor: _monthlyPlanMinor, ...category }) => category),
    }
    const legacyPayload = {
      format: LEDGER_BACKUP_FORMAT,
      version: LEDGER_BACKUP_VERSION,
      exportedAt: timestamp,
      schemaVersion: PRE_MONTHLY_PLAN_LEDGER_SCHEMA_VERSION,
      data: legacyData,
    } as const
    const backup = compatibleLedgerBackupSchema.parse({
      ...legacyPayload,
      checksum: {
        algorithm: 'SHA-256',
        digest: await checksumLedgerBackupPayload(legacyPayload),
      },
    })

    const upgraded = upgradeLedgerBackupData(backup)
    assert.equal(upgraded.currency, 'HKD')
    assert.deepEqual(upgraded.emergencyFundGoals, [])
    assert.equal(upgraded.categories[0]?.monthlyPlanMinor, null)
    assert.equal(upgraded.transactions[0]?.cleared, false)
    assert.deepEqual(upgraded.accountTransfers, [])
    assertNoInventedRecurringTransfers(upgraded, 0)
  })

  it('upgrades schema 8 backups with cleared history and no invented category plans', async () => {
    const current = ledgerData()
    const withoutTransfers = ledgerDataWithoutTransfers(current)
    const legacyData = {
      ...withoutTransfers,
      categories: current.categories.map(({ monthlyPlanMinor: _monthlyPlanMinor, ...category }) => category),
      transactions: current.transactions.map(({ cleared: _cleared, ...transaction }) => transaction),
    }
    const legacyPayload = {
      format: LEDGER_BACKUP_FORMAT,
      version: LEDGER_BACKUP_VERSION,
      exportedAt: timestamp,
      schemaVersion: LEGACY_LEDGER_SCHEMA_VERSION,
      data: legacyData,
    } as const
    const backup = compatibleLedgerBackupSchema.parse({
      ...legacyPayload,
      checksum: {
        algorithm: 'SHA-256',
        digest: await checksumLedgerBackupPayload(legacyPayload),
      },
    })

    const upgraded = upgradeLedgerBackupData(backup)
    assert.equal(upgraded.currency, 'HKD')
    assert.deepEqual(upgraded.emergencyFundGoals, [])
    assert.equal(upgraded.categories[0]?.monthlyPlanMinor, null)
    assert.equal(upgraded.transactions[0]?.cleared, true)
    assert.deepEqual(upgraded.accountTransfers, [])
    assertNoInventedRecurringTransfers(upgraded, 0)
  })

  it('rejects broken references, duplicate tombstones, and unusable reference data', () => {
    const data = ledgerData()
    data.accounts.forEach((account) => { account.isActive = false })
    data.categories[0].isActive = false
    data.transactions[0].categoryId = 999
    data.transactionImportKeys.push({ ...data.transactionImportKeys[0] })

    const issues = validateLedgerDataRelations(data)
    assert(issues.some(({ message }) => message === 'At least one active account is required'))
    assert(issues.some(({ message }) => message === 'At least one active expense category is required'))
    assert(issues.some(({ message }) => message === 'Referenced category is missing'))
    assert(issues.some(({ message }) => message === 'Emergency fund account must be active and cannot be a credit card'))
    assert(issues.some(({ path }) => path.endsWith('.importKey')))
  })

  it('rejects an emergency goal backed by a missing or credit-card account', () => {
    const missing = ledgerData()
    missing.emergencyFundGoals[0].accountId = 999
    assert(validateLedgerDataRelations(missing).some(
      ({ message }) => message === 'Referenced emergency fund account is missing',
    ))

    const credit = ledgerData()
    credit.accounts[0].type = 'credit_card'
    assert(validateLedgerDataRelations(credit).some(
      ({ message }) => message === 'Emergency fund account must be active and cannot be a credit card',
    ))
  })

  it('rejects transfer references that cannot form a valid account movement', () => {
    const data = ledgerData()
    data.accountTransfers.push({ ...data.accountTransfers[0] })
    data.accountTransfers[0].toAccountId = 999

    const issues = validateLedgerDataRelations(data)
    assert(issues.some(({ path }) => path.endsWith('.id')))
    assert(issues.some(({ message }) => message === 'Referenced destination account is missing'))
  })

  it('rejects missing recurring transfer rules and duplicate historical occurrences', () => {
    const data = ledgerData()
    data.accountTransfers.push({
      ...data.accountTransfers[0],
      id: '30000000-0000-4000-8000-000000000002',
    })
    data.recurringTransferRules = []

    const issues = validateLedgerDataRelations(data)
    assert(issues.some(({ path }) => path.endsWith('.recurringOccurrenceKey')))
    assert(issues.some(({ message }) => message === 'Referenced recurring transfer rule is missing'))
  })

  it('rejects recurring transfer rule references that cannot form a valid account movement', () => {
    const data = ledgerData()
    data.recurringTransferRules[0].fromAccountId = 999

    assert(validateLedgerDataRelations(data).some(
      ({ message }) => message === 'Referenced source account is missing',
    ))
    assert.equal(ledgerBackupRecurringTransferRuleSchema.safeParse({
      ...data.recurringTransferRules[0],
      fromAccountId: 1,
      toAccountId: 1,
    }).success, false)
  })

  it('rejects rows whose currency differs from the ledger currency', () => {
    const data = ledgerData()
    data.currency = 'USD'

    const paths = validateLedgerDataRelations(data).map(({ path }) => path)
    assert(paths.includes('data.accounts.0.currency'))
    assert(paths.includes('data.recurringRules.0.currency'))
    assert(paths.includes('data.recurringTransferRules.0.currency'))
    assert(paths.includes('data.transactions.0.currency'))
    assert(paths.includes('data.accountTransfers.0.currency'))
  })

  it('requires recurring transaction metadata to be complete and derived consistently', () => {
    const transaction = ledgerData().transactions[0]
    assert.equal(ledgerBackupTransactionSchema.safeParse(transaction).success, true)
    assert.equal(
      ledgerBackupTransactionSchema.safeParse({ ...transaction, recurringRuleName: null }).success,
      false,
    )
    assert.equal(
      ledgerBackupTransactionSchema.safeParse({
        ...transaction,
        recurringOccurrenceKey: `${transaction.recurringRuleId}:2026-07-12`,
      }).success,
      false,
    )
  })
})
