import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import type { StatementTransferImportInput } from '../lib/statementTransferImport'

type Row = Record<string, unknown>
type D1Result<T> = { success: true; results: T[]; meta: { changes: number } }

const childRun = process.env.HUSHL_STATEMENT_TRANSFER_IMPORT_SERVER_TEST === '1'

if (!childRun) {
  describe('statement transfer import server-only checks', () => {
    it('runs atomic transfer persistence under React server conditions', () => {
      const environment: NodeJS.ProcessEnv = {
        ...process.env,
        HUSHL_STATEMENT_TRANSFER_IMPORT_SERVER_TEST: '1',
      }
      delete environment.NODE_TEST_CONTEXT
      const result = spawnSync(
        process.execPath,
        ['--conditions=react-server', '--import', 'tsx', '--test', fileURLToPath(import.meta.url)],
        { encoding: 'utf8', env: environment },
      )
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    })
  })
} else {
  const { createStatementTransferImport } = await import('./statementTransferImport')
  class TestStatement {
    constructor(
      private readonly database: TestDatabase,
      private readonly sql: string,
      private readonly values: SQLInputValue[] = [],
    ) {}

    bind(...values: SQLInputValue[]) {
      return new TestStatement(this.database, this.sql, values)
    }

    async first<T extends Row>(): Promise<T | null> {
      return (this.database.raw.prepare(this.sql).get(...this.values) as T | undefined) ?? null
    }

    async run<T extends Row>(): Promise<D1Result<T>> {
      const statement = this.database.raw.prepare(this.sql)
      if (/\bRETURNING\b/i.test(this.sql) || !/\b(?:INSERT|UPDATE|DELETE)\b/i.test(this.sql)) {
        const results = statement.all(...this.values) as T[]
        return { success: true, results, meta: { changes: results.length } }
      }
      const result = statement.run(...this.values)
      return { success: true, results: [], meta: { changes: Number(result.changes) } }
    }
  }

  class TestDatabase {
    readonly raw = new DatabaseSync(':memory:')

    constructor() {
      this.raw.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE accounts (
          id INTEGER PRIMARY KEY,
          currency TEXT NOT NULL,
          is_active INTEGER NOT NULL CHECK(is_active IN (0, 1))
        );
        CREATE TABLE account_transfers (
          id TEXT PRIMARY KEY,
          amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
          currency TEXT NOT NULL,
          from_account_id INTEGER NOT NULL REFERENCES accounts(id),
          to_account_id INTEGER NOT NULL REFERENCES accounts(id),
          occurred_on TEXT NOT NULL,
          from_cleared INTEGER NOT NULL CHECK(from_cleared IN (0, 1)),
          to_cleared INTEGER NOT NULL CHECK(to_cleared IN (0, 1)),
          note TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          CHECK(from_account_id <> to_account_id)
        );
        CREATE TABLE transaction_import_keys (
          import_key TEXT PRIMARY KEY,
          transaction_id TEXT NOT NULL,
          imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        CREATE TABLE transactions (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          amount_minor INTEGER NOT NULL,
          currency TEXT NOT NULL,
          account_id INTEGER NOT NULL REFERENCES accounts(id),
          occurred_on TEXT NOT NULL,
          cleared INTEGER NOT NULL,
          category_id INTEGER,
          payee TEXT NOT NULL,
          note TEXT NOT NULL
        );
        INSERT INTO accounts VALUES
          (1, 'HKD', 1),
          (2, 'HKD', 1),
          (3, 'USD', 1),
          (4, 'HKD', 0);
      `)
    }

    prepare(sql: string) {
      return new TestStatement(this, sql)
    }

    async batch<T extends Row>(statements: TestStatement[]): Promise<D1Result<T>[]> {
      this.raw.exec('BEGIN IMMEDIATE')
      try {
        const results: D1Result<T>[] = []
        for (const statement of statements) results.push(await statement.run<T>())
        this.raw.exec('COMMIT')
        return results
      } catch (error) {
        this.raw.exec('ROLLBACK')
        throw error
      }
    }

    close() {
      this.raw.close()
    }
  }

  const key = (character: string) => `ai:statement:row:${character.repeat(64)}`
  const input = (overrides: Partial<StatementTransferImportInput> = {}): StatementTransferImportInput => ({
    importKey: key('a'),
    statementAccountId: 1,
    counterpartyAccountId: 2,
    amountMinor: 12_345,
    occurredOn: '2026-08-23',
    direction: 'outflow',
    note: 'Own-account transfer',
    ...overrides,
  })

  describe('statement transfer import persistence', () => {
    it('creates one native transfer and clears only the statement-account leg', async () => {
      const database = new TestDatabase()
      try {
        const transferId = '10000000-0000-4000-8000-000000000001'
        assert.deepEqual(await createStatementTransferImport(
          database as unknown as D1Database,
          input(),
          transferId,
        ), { kind: 'created', transferId })
        assert.deepEqual({ ...database.raw.prepare(`
          SELECT amount_minor AS amountMinor, currency,
            from_account_id AS fromAccountId, to_account_id AS toAccountId,
            from_cleared AS fromCleared, to_cleared AS toCleared,
            occurred_on AS occurredOn, note
          FROM account_transfers
        `).get() }, {
          amountMinor: 12_345,
          currency: 'HKD',
          fromAccountId: 1,
          toAccountId: 2,
          fromCleared: 1,
          toCleared: 0,
          occurredOn: '2026-08-23',
          note: 'Own-account transfer',
        })
      } finally {
        database.close()
      }
    })

    it('maps inflow to the destination statement leg', async () => {
      const database = new TestDatabase()
      try {
        await createStatementTransferImport(
          database as unknown as D1Database,
          input({ importKey: key('b'), direction: 'inflow' }),
          '10000000-0000-4000-8000-000000000002',
        )
        assert.deepEqual({ ...database.raw.prepare(`
          SELECT from_account_id AS fromAccountId, to_account_id AS toAccountId,
            from_cleared AS fromCleared, to_cleared AS toCleared
          FROM account_transfers
        `).get() }, {
          fromAccountId: 2,
          toAccountId: 1,
          fromCleared: 0,
          toCleared: 1,
        })
      } finally {
        database.close()
      }
    })

    it('matches the counter-account statement to one transfer and clears its remaining leg', async () => {
      const database = new TestDatabase()
      try {
        const transferId = '10000000-0000-4000-8000-000000000008'
        assert.deepEqual(await createStatementTransferImport(
          database as unknown as D1Database,
          input({ importKey: key('8') }),
          transferId,
        ), { kind: 'created', transferId })
        assert.deepEqual(await createStatementTransferImport(
          database as unknown as D1Database,
          input({
            importKey: key('9'),
            statementAccountId: 2,
            counterpartyAccountId: 1,
            direction: 'inflow',
          }),
          '10000000-0000-4000-8000-000000000009',
        ), { kind: 'matched', transferId })
        assert.deepEqual({ ...database.raw.prepare(`
          SELECT from_cleared AS fromCleared, to_cleared AS toCleared
          FROM account_transfers WHERE id = ?
        `).get(transferId) }, { fromCleared: 1, toCleared: 1 })
        assert.equal(database.raw.prepare('SELECT COUNT(*) AS count FROM account_transfers').get()?.count, 1)
        assert.equal(database.raw.prepare(`
          SELECT COUNT(*) AS count
          FROM transaction_import_keys WHERE transaction_id = ?
        `).get(transferId)?.count, 2)
      } finally {
        database.close()
      }
    })

    it('fails closed instead of choosing between duplicate exact transfers', async () => {
      const database = new TestDatabase()
      try {
        database.raw.exec(`
          INSERT INTO account_transfers(
            id, amount_minor, currency, from_account_id, to_account_id,
            occurred_on, from_cleared, to_cleared, note
          ) VALUES
            ('10000000-0000-4000-8000-000000000010', 12345, 'HKD', 1, 2,
             '2026-08-23', 1, 0, ''),
            ('10000000-0000-4000-8000-000000000011', 12345, 'HKD', 1, 2,
             '2026-08-23', 1, 0, '');
        `)
        assert.deepEqual(await createStatementTransferImport(
          database as unknown as D1Database,
          input({
            importKey: key('7'),
            statementAccountId: 2,
            counterpartyAccountId: 1,
            direction: 'inflow',
          }),
          '10000000-0000-4000-8000-000000000012',
        ), { kind: 'possible_duplicate' })
        assert.equal(database.raw.prepare('SELECT COUNT(*) AS count FROM account_transfers').get()?.count, 2)
        assert.equal(database.raw.prepare('SELECT COUNT(*) AS count FROM transaction_import_keys').get()?.count, 0)
      } finally {
        database.close()
      }
    })

    it('does not consume a new key for an already-cleared exact transfer', async () => {
      const database = new TestDatabase()
      try {
        database.raw.exec(`
          INSERT INTO account_transfers(
            id, amount_minor, currency, from_account_id, to_account_id,
            occurred_on, from_cleared, to_cleared, note
          ) VALUES (
            '10000000-0000-4000-8000-000000000013', 12345, 'HKD', 1, 2,
            '2026-08-23', 1, 1, ''
          );
        `)
        assert.deepEqual(await createStatementTransferImport(
          database as unknown as D1Database,
          input({ importKey: key('6') }),
          '10000000-0000-4000-8000-000000000014',
        ), { kind: 'possible_duplicate' })
        assert.equal(database.raw.prepare('SELECT COUNT(*) AS count FROM account_transfers').get()?.count, 1)
        assert.equal(database.raw.prepare('SELECT COUNT(*) AS count FROM transaction_import_keys').get()?.count, 0)
      } finally {
        database.close()
      }
    })

    it('flags a nearby counter-account posting instead of creating a second transfer', async () => {
      const database = new TestDatabase()
      try {
        database.raw.exec(`
          INSERT INTO account_transfers(
            id, amount_minor, currency, from_account_id, to_account_id,
            occurred_on, from_cleared, to_cleared, note
          ) VALUES (
            '10000000-0000-4000-8000-000000000015', 12345, 'HKD', 1, 2,
            '2026-08-21', 1, 0, ''
          );
        `)
        assert.deepEqual(await createStatementTransferImport(
          database as unknown as D1Database,
          input({
            importKey: key('5'),
            statementAccountId: 2,
            counterpartyAccountId: 1,
            direction: 'inflow',
          }),
          '10000000-0000-4000-8000-000000000016',
        ), { kind: 'possible_duplicate' })
        assert.equal(database.raw.prepare('SELECT COUNT(*) AS count FROM account_transfers').get()?.count, 1)
        assert.equal(database.raw.prepare('SELECT COUNT(*) AS count FROM transaction_import_keys').get()?.count, 0)
      } finally {
        database.close()
      }
    })

    it('never converts an existing ordinary transaction into a second transfer', async () => {
      for (const cleared of [0, 1]) {
        const database = new TestDatabase()
        try {
          database.raw.prepare(`
            INSERT INTO transactions(
              id, type, amount_minor, currency, account_id, occurred_on,
              cleared, category_id, payee, note
            ) VALUES (?, 'expense', 12345, 'HKD', 1, '2026-08-23', ?, 999, ?, ?)
          `).run(
            `10000000-0000-4000-8000-00000000001${cleared}`,
            cleared,
            cleared === 1 ? 'Different cleared payee' : 'Different pending payee',
            cleared === 1 ? 'different cleared note' : 'different pending note',
          )
          assert.deepEqual(await createStatementTransferImport(
            database as unknown as D1Database,
            input({ importKey: key(cleared === 1 ? '4' : '3') }),
            `10000000-0000-4000-8000-00000000002${cleared}`,
          ), { kind: 'possible_duplicate' })
          assert.equal(database.raw.prepare('SELECT COUNT(*) AS count FROM account_transfers').get()?.count, 0)
          assert.equal(database.raw.prepare('SELECT COUNT(*) AS count FROM transaction_import_keys').get()?.count, 0)
        } finally {
          database.close()
        }
      }
    })

    it('keeps a tombstone after deletion and never recreates a replay', async () => {
      const database = new TestDatabase()
      try {
        const firstId = '10000000-0000-4000-8000-000000000003'
        await createStatementTransferImport(
          database as unknown as D1Database,
          input({ importKey: key('c') }),
          firstId,
        )
        database.raw.prepare('DELETE FROM account_transfers WHERE id = ?').run(firstId)
        assert.deepEqual(await createStatementTransferImport(
          database as unknown as D1Database,
          input({ importKey: key('c') }),
          '10000000-0000-4000-8000-000000000004',
        ), { kind: 'already_imported' })
        assert.equal(database.raw.prepare('SELECT COUNT(*) AS count FROM account_transfers').get()?.count, 0)
        assert.equal(
          database.raw.prepare('SELECT COUNT(*) AS count FROM transaction_import_keys').get()?.count,
          1,
        )
      } finally {
        database.close()
      }
    })

    it('rejects inactive and currency-mismatched accounts without reserving the key', async () => {
      const database = new TestDatabase()
      try {
        for (const [character, counterpartyAccountId] of [['d', 3], ['e', 4]] as const) {
          assert.deepEqual(await createStatementTransferImport(
            database as unknown as D1Database,
            input({ importKey: key(character), counterpartyAccountId }),
            `10000000-0000-4000-8000-00000000000${counterpartyAccountId}`,
          ), { kind: 'reference_invalid' })
        }
        assert.equal(
          database.raw.prepare('SELECT COUNT(*) AS count FROM transaction_import_keys').get()?.count,
          0,
        )
      } finally {
        database.close()
      }
    })

    it('honors a transaction import tombstone from the shared key namespace', async () => {
      const database = new TestDatabase()
      try {
        const transactionId = '10000000-0000-4000-8000-000000000006'
        database.raw.prepare(`
          INSERT INTO transaction_import_keys(import_key, transaction_id)
          VALUES (?, ?)
        `).run(key('f'), transactionId)
        assert.deepEqual(await createStatementTransferImport(
          database as unknown as D1Database,
          input({ importKey: key('f') }),
          '10000000-0000-4000-8000-000000000007',
        ), { kind: 'already_imported' })
        assert.equal(database.raw.prepare('SELECT COUNT(*) AS count FROM account_transfers').get()?.count, 0)
      } finally {
        database.close()
      }
    })
  })
}
