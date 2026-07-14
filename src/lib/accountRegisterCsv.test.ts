import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AccountRegister } from './schema'
import { accountRegisterToCsv } from './accountRegisterCsv'

const register: AccountRegister = {
  accountId: 7,
  accountName: '＝Statement account',
  accountLocalizationKey: null,
  month: '2026-07',
  dateFrom: '2026-07-01',
  dateTo: '2026-07-31',
  availableFrom: null,
  startingBalanceMinor: 100_000,
  endingBalanceMinor: 103_000,
  clearedEndingBalanceMinor: 105_000,
  unclearedEndingBalanceMinor: -2_000,
  unclearedCount: 1,
  entryCount: 2,
  entries: [
    {
      entryId: 'transfer:20000000-0000-4000-8000-000000000001',
      sourceId: '20000000-0000-4000-8000-000000000001',
      kind: 'transfer',
      updatedAt: '2026-07-03T08:00:00.000Z',
      occurredOn: '2026-07-03',
      amountMinor: -2_000,
      runningBalanceMinor: 103_000,
      cleared: false,
      payee: '',
      note: ' ＝Reserve',
      categoryName: null,
      categoryLocalizationKey: null,
      counterpartyAccountName: '＠Wallet',
      counterpartyAccountLocalizationKey: null,
      transferDirection: 'out',
    },
    {
      entryId: 'transaction:10000000-0000-4000-8000-000000000001',
      sourceId: '10000000-0000-4000-8000-000000000001',
      kind: 'transaction',
      updatedAt: '2026-07-02T08:00:00.000Z',
      occurredOn: '2026-07-02',
      amountMinor: 5_000,
      runningBalanceMinor: 105_000,
      cleared: true,
      payee: '－Employer',
      note: '',
      categoryName: '＋Salary',
      categoryLocalizationKey: null,
      counterpartyAccountName: null,
      counterpartyAccountLocalizationKey: null,
      transferDirection: null,
    },
  ],
}

describe('account-register CSV export', () => {
  it('exports a known range start followed by exact oldest-first signed activity', () => {
    const csv = accountRegisterToCsv(register, 'HKD')
    const lines = csv.slice(1).trimEnd().split('\r\n')

    assert.equal(
      lines[0],
      'Date,Entry Kind,Amount,Currency,Cleared,Running Balance,Account,Account ID,Category,Payee,Counterparty Account,Transfer Direction,Note,Entry ID,Source ID',
    )
    assert(lines.every((line) => line.split(',').length === 15))
    assert.match(lines[1], /^2026-07-01,range_start,,HKD,,1000\.00,/)
    assert.match(lines[2], /^2026-07-02,transaction,50\.00,HKD,Cleared,1050\.00,/)
    assert.match(lines[3], /^2026-07-03,transfer,-20\.00,HKD,Uncleared,1030\.00,/)
    assert.match(csv, /"'＝Statement account"/)
    assert.match(csv, /"'＋Salary"/)
    assert.match(csv, /"'－Employer"/)
    assert.match(csv, /"'＠Wallet"/)
    assert.match(csv, /"' ＝Reserve"/)
    assert(csv.endsWith('\r\n'))
  })

  it('does not fabricate a range start and leaves an opening entry uncleared', () => {
    const csv = accountRegisterToCsv({
      ...register,
      startingBalanceMinor: null,
      entryCount: 1,
      entries: [{
        ...register.entries[0],
        entryId: 'opening:7:2026-07-03',
        sourceId: null,
        kind: 'opening',
        updatedAt: null,
        amountMinor: 50_000,
        runningBalanceMinor: 50_000,
        cleared: null,
        counterpartyAccountName: null,
        transferDirection: null,
      }],
    }, 'HKD')

    assert.doesNotMatch(csv, /,range_start,/)
    assert.match(csv, /2026-07-03,opening,500\.00,HKD,,500\.00,/)
  })

  it('returns only the stable header when the complete range predates known history', () => {
    const csv = accountRegisterToCsv({
      ...register,
      startingBalanceMinor: null,
      endingBalanceMinor: null,
      clearedEndingBalanceMinor: null,
      unclearedEndingBalanceMinor: null,
      unclearedCount: null,
      entryCount: 0,
      entries: [],
    }, 'HKD')

    assert.equal(csv.slice(1).trimEnd().split('\r\n').length, 1)
    assert.doesNotMatch(csv, /,range_start,|,opening,|,transaction,|,transfer,/)
    assert(csv.endsWith('\r\n'))
  })
})
