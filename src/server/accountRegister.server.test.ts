import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

type Row = Record<string, unknown>
type BatchResult<T> = {
  success: true
  results: T[]
  meta: { changes: number }
}

const childRun = process.env.HUSHL_REGISTER_SERVER_TEST === '1'

if (!childRun) {
  describe('account register server-only checks', () => {
    it('runs the SQLite contract under React server conditions', () => {
      const environment: NodeJS.ProcessEnv = {
        ...process.env,
        HUSHL_REGISTER_SERVER_TEST: '1',
      }
      delete environment.NODE_TEST_CONTEXT
      const result = spawnSync(
        process.execPath,
        ['--conditions=react-server', '--import', 'tsx', '--test', fileURLToPath(import.meta.url)],
        {
          encoding: 'utf8',
          env: environment,
        },
      )
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    })
  })
} else {
  const {
    getAccountRegister,
    getAccountUnclearedReview,
    setAccountRegisterEntryClearing,
  } = await import('./accountRegister')

  class TestStatement {
    constructor(
      private readonly database: TestDatabase,
      private readonly sql: string,
      private readonly values: SQLInputValue[] = [],
    ) {}

    bind(...values: SQLInputValue[]) {
      return new TestStatement(this.database, this.sql, values)
    }

    async all<T extends Row>(): Promise<BatchResult<T>> {
      const rows = this.database.raw.prepare(this.sql).all(...this.values) as T[]
      return {
        success: true,
        results: this.database.transform ? this.database.transform(rows) as T[] : rows,
        meta: { changes: 0 },
      }
    }

    async first<T extends Row>(): Promise<T | null> {
      return (this.database.raw.prepare(this.sql).get(...this.values) as T | undefined) ?? null
    }

    async run<T extends Row>(): Promise<BatchResult<T>> {
      const rows = this.database.raw.prepare(this.sql).all(...this.values) as T[]
      return { success: true, results: rows, meta: { changes: rows.length } }
    }
  }

  class TestDatabase {
    readonly raw = new DatabaseSync(':memory:')
    prepareCount = 0
    transform: ((rows: Row[]) => Row[]) | null = null

    constructor() {
      this.raw.exec(TEST_SCHEMA)
    }

    prepare(sql: string) {
      this.prepareCount += 1
      return new TestStatement(this, sql)
    }

    close() {
      this.raw.close()
    }
  }

  const TEST_SCHEMA = `
    CREATE TABLE accounts (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      localization_key TEXT,
      opening_balance_minor INTEGER,
      opening_balance_on TEXT
    );
    CREATE TABLE categories (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      localization_key TEXT
    );
    CREATE TABLE transactions (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      account_id INTEGER NOT NULL,
      category_id INTEGER NOT NULL,
      occurred_on TEXT NOT NULL,
      cleared INTEGER NOT NULL,
      payee TEXT NOT NULL,
      note TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE account_transfers (
      id TEXT PRIMARY KEY,
      amount_minor INTEGER NOT NULL,
      from_account_id INTEGER NOT NULL,
      to_account_id INTEGER NOT NULL,
      occurred_on TEXT NOT NULL,
      from_cleared INTEGER NOT NULL,
      to_cleared INTEGER NOT NULL,
      note TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `

  const transactionId = '10000000-0000-4000-8000-000000000002'
  const transferId = '20000000-0000-4000-8000-000000000001'
  const oldVersion = '2099-01-01T00:00:00.000Z'

  function seededDatabase() {
    const database = new TestDatabase()
    database.raw.exec(`
      INSERT INTO accounts VALUES
        (1, 'Checking', NULL, 1000, '2026-01-01'),
        (2, 'Savings', NULL, 0, '2026-01-01'),
        (3, 'Future', NULL, 500, '2027-01-01');
      INSERT INTO categories VALUES (1, 'Salary', NULL), (2, 'Food', NULL);
      INSERT INTO transactions VALUES
        ('10000000-0000-4000-8000-000000000001', 'income', 500, 1, 1,
          '2026-01-02', 1, 'Employer', '', '2026-01-02T00:00:00.000Z', '${oldVersion}'),
        ('${transactionId}', 'expense', 200, 1, 2,
          '2026-01-03', 0, 'Market', '', '2026-01-03T00:00:00.000Z', '${oldVersion}'),
        ('10000000-0000-4000-8000-000000000003', 'income', 100, 1, 1,
          '2026-01-04', 1, 'Refund', '', '2026-01-04T00:00:00.000Z', '${oldVersion}');
      INSERT INTO account_transfers VALUES
        ('${transferId}', 300, 1, 2, '2026-01-05', 0, 0, 'Move',
          '2026-01-05T00:00:00.000Z', '${oldVersion}'),
        ('20000000-0000-4000-8000-000000000002', 50, 2, 1, '2026-01-06', 1, 0, 'Return',
          '2026-01-06T00:00:00.000Z', '${oldVersion}');
    `)
    const insert = database.raw.prepare(`
      INSERT INTO transactions VALUES (?, 'expense', 1, 1, 2, '2026-01-02', 0, '', '',
        '2026-01-02T01:00:00.000Z', ?)
    `)
    for (let index = 1; index <= 201; index += 1) {
      insert.run(`30000000-0000-4000-8000-${String(index).padStart(12, '0')}`, oldVersion)
    }
    database.prepareCount = 0
    return database
  }

  function d1(database: TestDatabase) {
    return database as unknown as D1Database
  }

  describe('complete uncleared account review', () => {
    it('returns an uncapped, private subset with balances calculated over every movement', async () => {
      const database = seededDatabase()
      try {
        const review = await getAccountUnclearedReview(
          d1(database),
          { accountId: 1, dateTo: '2026-01-06' },
        )
        assert(review)
        assert.equal(database.prepareCount, 1)
        assert.deepEqual(
          {
            complete: review.complete,
            ending: review.endingBalanceMinor,
            cleared: review.clearedEndingBalanceMinor,
            uncleared: review.unclearedEndingBalanceMinor,
            count: review.unclearedCount,
          },
          { complete: true, ending: 949, cleared: 1600, uncleared: -651, count: 204 },
        )
        assert.equal(review.entries.length, 204)
        assert(review.entries.every((entry) => (
          entry.cleared === false
          && entry.sourceId !== null
          && entry.updatedAt !== null
        )))
        assert.deepEqual(
          review.entries.slice(0, 3).map(({ entryId, runningBalanceMinor }) => ({
            entryId,
            runningBalanceMinor,
          })),
          [
            {
              entryId: 'transfer:20000000-0000-4000-8000-000000000002',
              runningBalanceMinor: 949,
            },
            { entryId: `transfer:${transferId}`, runningBalanceMinor: 899 },
            { entryId: `transaction:${transactionId}`, runningBalanceMinor: 1099 },
          ],
        )
        assert(!review.entries.some(({ payee }) => payee === 'Employer' || payee === 'Refund'))
      } finally {
        database.close()
      }
    })

    it('returns a complete empty snapshot before the account opening boundary', async () => {
      const database = seededDatabase()
      try {
        const review = await getAccountUnclearedReview(
          d1(database),
          { accountId: 3, dateTo: '2026-01-06' },
        )
        assert.deepEqual(review && {
          availableFrom: review.availableFrom,
          ending: review.endingBalanceMinor,
          cleared: review.clearedEndingBalanceMinor,
          uncleared: review.unclearedEndingBalanceMinor,
          count: review.unclearedCount,
          entries: review.entries,
        }, {
          availableFrom: '2027-01-01',
          ending: null,
          cleared: null,
          uncleared: null,
          count: 0,
          entries: [],
        })
      } finally {
        database.close()
      }
    })

    it('populates source versions in normal registers and keeps opening entries versionless', async () => {
      const database = seededDatabase()
      try {
        const normal = await getAccountRegister(d1(database), {
          accountId: 1,
          dateFrom: '2026-01-01',
          dateTo: '2026-01-06',
        })
        assert(normal)
        assert(normal.entries.every((entry) => entry.kind === 'opening'
          ? entry.updatedAt === null
          : typeof entry.updatedAt === 'string'))

        const opening = await getAccountRegister(d1(database), {
          accountId: 3,
          dateFrom: '2026-12-31',
          dateTo: '2027-01-01',
        })
        assert.equal(opening?.entries[0]?.kind, 'opening')
        assert.equal(opening?.entries[0]?.updatedAt, null)
      } finally {
        database.close()
      }
    })

    it('fails closed for partial, duplicate, cleared, or unsafe result rows', async () => {
      const transforms: Array<(rows: Row[]) => Row[]> = [
        (rows) => rows.slice(1),
        (rows) => rows.map((row, index) => index === 1 ? { ...rows[0] } : row),
        (rows) => rows.map((row, index) => index === 0 ? { ...row, cleared: 1 } : row),
        (rows) => rows.map((row, index) => index === 0
          ? { ...row, runningBalanceMinor: Number.MAX_SAFE_INTEGER + 1 }
          : row),
      ]

      for (const transform of transforms) {
        const database = seededDatabase()
        database.transform = transform
        try {
          await assert.rejects(
            getAccountUnclearedReview(d1(database), { accountId: 1, dateTo: '2026-01-06' }),
            /complete uncleared account review/i,
          )
        } finally {
          database.close()
        }
      }
    })
  })

  describe('narrow account register clearing', () => {
    it('updates only the selected transfer leg and rejects stale or mismatched writes', async () => {
      const database = seededDatabase()
      try {
        const input = {
          accountId: 1,
          kind: 'transfer' as const,
          sourceId: transferId,
          updatedAt: oldVersion,
          cleared: true,
        }
        assert.deepEqual(
          await setAccountRegisterEntryClearing(d1(database), { ...input, accountId: 3 }),
          { kind: 'account_mismatch' },
        )
        const updated = await setAccountRegisterEntryClearing(d1(database), input)
        assert.equal(updated.kind, 'updated')
        if (updated.kind !== 'updated') return
        assert(updated.updatedAt > oldVersion)
        const legs = database.raw.prepare(`
            SELECT from_cleared AS fromCleared, to_cleared AS toCleared
            FROM account_transfers WHERE id = ?
          `).get(transferId) as { fromCleared: number; toCleared: number }
        assert.deepEqual(
          { ...legs },
          { fromCleared: 1, toCleared: 0 },
        )
        assert.deepEqual(
          await setAccountRegisterEntryClearing(d1(database), input),
          { kind: 'version_conflict' },
        )
      } finally {
        database.close()
      }
    })

    it('updates only the destination transfer leg when reviewing the receiving account', async () => {
      const database = seededDatabase()
      try {
        const updated = await setAccountRegisterEntryClearing(d1(database), {
          accountId: 2,
          kind: 'transfer',
          sourceId: transferId,
          updatedAt: oldVersion,
          cleared: true,
        })
        assert.equal(updated.kind, 'updated')
        const legs = database.raw.prepare(`
            SELECT from_cleared AS fromCleared, to_cleared AS toCleared
            FROM account_transfers WHERE id = ?
          `).get(transferId) as { fromCleared: number; toCleared: number }
        assert.deepEqual(
          { ...legs },
          { fromCleared: 0, toCleared: 1 },
        )
      } finally {
        database.close()
      }
    })

    it('classifies transaction ownership, versions, and missing sources without writing', async () => {
      const database = seededDatabase()
      try {
        const input = {
          accountId: 1,
          kind: 'transaction' as const,
          sourceId: transactionId,
          updatedAt: oldVersion,
          cleared: true,
        }
        assert.deepEqual(
          await setAccountRegisterEntryClearing(d1(database), { ...input, accountId: 2 }),
          { kind: 'account_mismatch' },
        )
        assert.deepEqual(
          await setAccountRegisterEntryClearing(d1(database), { ...input, updatedAt: '2098-01-01T00:00:00.000Z' }),
          { kind: 'version_conflict' },
        )
        assert.deepEqual(
          await setAccountRegisterEntryClearing(d1(database), {
            ...input,
            sourceId: '90000000-0000-4000-8000-000000000001',
          }),
          { kind: 'not_found' },
        )
        const unchanged = database.raw.prepare(
          'SELECT cleared FROM transactions WHERE id = ?',
        ).get(transactionId) as { cleared: number }
        assert.equal(unchanged.cleared, 0)
      } finally {
        database.close()
      }
    })
  })
}
