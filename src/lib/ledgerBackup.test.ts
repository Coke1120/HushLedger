import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  LEDGER_BACKUP_FORMAT,
  LEDGER_BACKUP_VERSION,
  LEGACY_LEDGER_SCHEMA_VERSION,
  LEDGER_SCHEMA_VERSION,
  PRE_MONTHLY_PLAN_LEDGER_SCHEMA_VERSION,
  PRE_OPENING_BALANCE_LEDGER_SCHEMA_VERSION,
  PRE_TRANSFERS_LEDGER_SCHEMA_VERSION,
  PREVIOUS_LEDGER_SCHEMA_VERSION,
  canonicalJson,
  checksumLedgerBackupPayload,
  compatibleLedgerBackupSchema,
  countLedgerData,
  digestLedgerData,
  ledgerBackupTransactionSchema,
  upgradeLedgerBackupData,
  validateLedgerDataRelations,
  type LedgerBackupData,
  type LedgerBackupPayload,
} from './ledgerBackup'

const timestamp = '2026-07-13T00:00:00.000Z'

function ledgerData(): LedgerBackupData {
  return {
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
      occurredOn: '2026-07-13',
      fromCleared: true,
      toCleared: false,
      note: 'Cash withdrawal',
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

function ledgerDataBeforeEmergencyFund(data: LedgerBackupData) {
  return {
    accounts: data.accounts,
    categories: data.categories,
    recurringRules: data.recurringRules,
    transactions: data.transactions,
    accountTransfers: data.accountTransfers,
    transactionImportKeys: data.transactionImportKeys,
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

  it('accepts a complete ledger and counts every restorable table', async () => {
    const data = ledgerData()
    assert.deepEqual(validateLedgerDataRelations(data), [])
    assert.deepEqual(countLedgerData(data), {
      accounts: 2,
      categories: 2,
      recurringRules: 1,
      transactions: 1,
      accountTransfers: 1,
      emergencyFundGoals: 1,
      transactionImportKeys: 1,
    })
    assert.match(await digestLedgerData(data), /^[0-9a-f]{64}$/)
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
    assert.deepEqual(upgraded.emergencyFundGoals, [])
    assert.equal(upgraded.accountTransfers.length, 1)
    assert.equal(upgraded.accounts[0]?.openingBalanceMinor, 125_000)
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
    assert.deepEqual(upgraded.emergencyFundGoals, [])
    assert.equal(upgraded.accountTransfers.length, 1)
    assert.equal(upgraded.accounts[0]?.openingBalanceMinor, null)
    assert.equal(upgraded.accounts[0]?.openingBalanceOn, null)
    assert.equal(upgraded.categories[0]?.monthlyPlanMinor, 50_000)
    assert.equal(upgraded.transactions[0]?.cleared, false)
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
    assert.deepEqual(upgraded.emergencyFundGoals, [])
    assert.deepEqual(upgraded.accountTransfers, [])
    assert.equal(upgraded.accounts[0]?.openingBalanceMinor, null)
    assert.equal(upgraded.categories[0]?.monthlyPlanMinor, 50_000)
    assert.equal(upgraded.transactions[0]?.cleared, false)
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
    assert.deepEqual(upgraded.emergencyFundGoals, [])
    assert.equal(upgraded.categories[0]?.monthlyPlanMinor, null)
    assert.equal(upgraded.transactions[0]?.cleared, false)
    assert.deepEqual(upgraded.accountTransfers, [])
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
    assert.deepEqual(upgraded.emergencyFundGoals, [])
    assert.equal(upgraded.categories[0]?.monthlyPlanMinor, null)
    assert.equal(upgraded.transactions[0]?.cleared, true)
    assert.deepEqual(upgraded.accountTransfers, [])
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
