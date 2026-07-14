import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  LEDGER_BACKUP_PREPARED_STORAGE_KEY,
  LEDGER_BACKUP_VERIFIED_STORAGE_KEY,
  applyLedgerBackupStorageChange,
  emptyLedgerBackupHealth,
  isLedgerBackupDue,
  mergeLedgerBackupHealth,
  parseLedgerBackupHealth,
  recordLedgerBackupPreparation,
  recordLedgerBackupVerification,
} from './ledgerBackupHealth'

describe('ledger backup health', () => {
  it('accepts only canonical timestamps from browser storage', () => {
    assert.deepEqual(parseLedgerBackupHealth(
      '2026-07-01T10:30:00.000Z',
      'not-a-date',
    ), {
      lastPreparedAt: '2026-07-01T10:30:00.000Z',
      lastVerifiedAt: null,
    })
    assert.deepEqual(parseLedgerBackupHealth('{broken', '[]'), emptyLedgerBackupHealth)
  })

  it('records backup preparation and verification independently', () => {
    const prepared = recordLedgerBackupPreparation(
      emptyLedgerBackupHealth,
      new Date('2026-07-01T10:30:00.000Z'),
    )
    const verified = recordLedgerBackupVerification(
      prepared,
      new Date('2026-07-02T11:45:00.000Z'),
    )

    assert.deepEqual(verified, {
      lastPreparedAt: '2026-07-01T10:30:00.000Z',
      lastVerifiedAt: '2026-07-02T11:45:00.000Z',
    })
  })

  it('applies independent storage events without erasing the other activity', () => {
    const prepared = applyLedgerBackupStorageChange(
      emptyLedgerBackupHealth,
      LEDGER_BACKUP_PREPARED_STORAGE_KEY,
      '2026-07-03T10:30:00.000Z',
    )
    assert.deepEqual(applyLedgerBackupStorageChange(
      prepared,
      LEDGER_BACKUP_VERIFIED_STORAGE_KEY,
      '2026-07-04T11:45:00.000Z',
    ), {
      lastPreparedAt: '2026-07-03T10:30:00.000Z',
      lastVerifiedAt: '2026-07-04T11:45:00.000Z',
    })
    assert.deepEqual(applyLedgerBackupStorageChange({
      lastPreparedAt: '2026-07-03T10:30:00.000Z',
      lastVerifiedAt: null,
    }, 'unrelated.key', '2026-07-05T00:00:00.000Z'), {
      lastPreparedAt: '2026-07-03T10:30:00.000Z',
      lastVerifiedAt: null,
    })
  })

  it('merges a storage event that arrives before the deferred initial read', () => {
    assert.deepEqual(mergeLedgerBackupHealth({
      lastPreparedAt: null,
      lastVerifiedAt: '2026-07-04T11:45:00.000Z',
    }, {
      lastPreparedAt: '2026-07-03T10:30:00.000Z',
      lastVerifiedAt: '2026-07-02T11:45:00.000Z',
    }), {
      lastPreparedAt: '2026-07-03T10:30:00.000Z',
      lastVerifiedAt: '2026-07-04T11:45:00.000Z',
    })
  })

  it('reminds after 30 days and rejects future browser timestamps', () => {
    const health = recordLedgerBackupPreparation(
      emptyLedgerBackupHealth,
      new Date('2026-06-01T00:00:00.000Z'),
    )

    assert.equal(isLedgerBackupDue(emptyLedgerBackupHealth, new Date('2026-06-01T00:00:00.000Z')), true)
    assert.equal(isLedgerBackupDue(health, new Date('2026-06-30T23:59:59.999Z')), false)
    assert.equal(isLedgerBackupDue(health, new Date('2026-07-01T00:00:00.000Z')), true)
    assert.equal(isLedgerBackupDue(health, new Date('2026-05-31T23:59:59.999Z')), true)
  })

  it('does not treat integrity verification as a prepared backup download', () => {
    const verifiedOnly = recordLedgerBackupVerification(
      emptyLedgerBackupHealth,
      new Date('2026-07-01T00:00:00.000Z'),
    )

    assert.equal(isLedgerBackupDue(verifiedOnly, new Date('2026-07-01T00:00:01.000Z')), true)
  })
})
