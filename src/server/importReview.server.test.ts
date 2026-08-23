import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import type { TransactionImportRow } from '../lib/transactionImport'

type Row = Record<string, unknown>
type BatchResult<T> = {
  success: true
  results: T[]
  meta: { changes: number }
}

function plainRows(rows: readonly Row[]) {
  return rows.map((row) => ({ ...row }))
}

const childRun = process.env.HUSHL_IMPORT_REVIEW_SERVER_TEST === '1'

if (!childRun) {
  describe('import review migration', () => {
    it('backfills only surviving import-linked transactions and enforces the three states', () => {
      const database = new DatabaseSync(':memory:')
      try {
        database.exec(`
          CREATE TABLE transactions (
            id TEXT PRIMARY KEY,
            occurred_on TEXT NOT NULL,
            created_at TEXT NOT NULL
          );
          CREATE TABLE transaction_import_keys (
            import_key TEXT PRIMARY KEY,
            transaction_id TEXT NOT NULL
          );
          INSERT INTO transactions VALUES
            ('manual', '2026-07-01', '2026-07-01T00:00:00.000Z'),
            ('imported', '2026-07-02', '2026-07-02T00:00:00.000Z'),
            ('recurring', '2026-07-03', '2026-07-03T00:00:00.000Z');
          INSERT INTO transaction_import_keys VALUES
            ('existing-import-key-0001', 'imported'),
            ('deleted-import-key-00002', 'deleted');
        `)
        database.exec(readFileSync(
          new URL('../../migrations/0018_import_review_status.sql', import.meta.url),
          'utf8',
        ))

        assert.deepEqual(plainRows(database.prepare(`
          SELECT id, import_review_status AS status
          FROM transactions
          ORDER BY id
        `).all()), [
          { id: 'imported', status: 'unreviewed' },
          { id: 'manual', status: null },
          { id: 'recurring', status: null },
        ])
        assert.throws(() => database.prepare(`
          UPDATE transactions SET import_review_status = 'ignored' WHERE id = 'manual'
        `).run(), /CHECK constraint/i)
        const index = database.prepare(`
          SELECT sql FROM sqlite_master
          WHERE type = 'index' AND name = 'idx_transactions_import_review_status'
        `).get() as { sql?: string } | undefined
        assert.match(index?.sql ?? '', /WHERE import_review_status IS NOT NULL/i)
      } finally {
        database.close()
      }
    })
  })

  describe('import review server-only checks', () => {
    it('runs atomic review and import contracts under React server conditions', () => {
      const environment: NodeJS.ProcessEnv = {
        ...process.env,
        HUSHL_IMPORT_REVIEW_SERVER_TEST: '1',
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
  const { commitTransactionImport, previewTransactionImport } = await import('./transactionImport')
  const {
    createTransaction,
    deleteTransaction,
    listTransactions,
    setTransactionsImportReviewStatus,
  } = await import('./money')

  class TestStatement {
    constructor(
      private readonly database: TestDatabase,
      readonly sql: string,
      readonly values: SQLInputValue[] = [],
    ) {}

    bind(...values: SQLInputValue[]) {
      return new TestStatement(this.database, this.sql, values)
    }

    async all<T extends Row>(): Promise<BatchResult<T>> {
      const rows = this.database.raw.prepare(this.sql).all(...this.values) as T[]
      return { success: true, results: rows, meta: { changes: 0 } }
    }

    async first<T extends Row>(): Promise<T | null> {
      return (this.database.raw.prepare(this.sql).get(...this.values) as T | undefined) ?? null
    }

    async run(): Promise<BatchResult<Row>> {
      const result = this.database.raw.prepare(this.sql).run(...this.values)
      return { success: true, results: [], meta: { changes: Number(result.changes) } }
    }
  }

  class TestDatabase {
    readonly raw = new DatabaseSync(':memory:')

    constructor() {
      this.raw.exec(TEST_SCHEMA)
    }

    prepare(sql: string) {
      return new TestStatement(this, sql)
    }

    async batch(statements: TestStatement[]) {
      this.raw.exec('BEGIN')
      try {
        const results = []
        for (const statement of statements) {
          results.push(
            /\bRETURNING\b/i.test(statement.sql)
              || !/\b(?:INSERT|UPDATE|DELETE)\b/i.test(statement.sql)
              ? await statement.all()
              : await statement.run(),
          )
        }
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

  const TEST_SCHEMA = `
    CREATE TABLE accounts (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      localization_key TEXT,
      currency TEXT NOT NULL,
      is_active INTEGER NOT NULL
    );
    CREATE TABLE categories (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      localization_key TEXT,
      icon TEXT NOT NULL,
      color TEXT NOT NULL,
      type TEXT NOT NULL,
      is_active INTEGER NOT NULL
    );
    CREATE TABLE transactions (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      currency TEXT NOT NULL,
      account_id INTEGER NOT NULL,
      category_id INTEGER NOT NULL,
      occurred_on TEXT NOT NULL,
      cleared INTEGER NOT NULL,
      payee TEXT NOT NULL,
      note TEXT NOT NULL,
      recurring_rule_id TEXT,
      recurring_rule_name TEXT,
      recurrence_due_on TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      import_review_status TEXT CHECK(
        import_review_status IS NULL
        OR import_review_status IN ('unreviewed', 'reviewed', 'needs_follow_up')
      )
    );
    CREATE TABLE transaction_import_keys (
      import_key TEXT PRIMARY KEY,
      transaction_id TEXT NOT NULL
    );
    INSERT INTO accounts VALUES (1, 'Checking', NULL, 'HKD', 1);
    INSERT INTO categories VALUES (1, 'Food', NULL, 'utensils', '#123456', 'expense', 1);
  `

  const manualId = '10000000-0000-4000-8000-000000000001'
  const importedId = '10000000-0000-4000-8000-000000000002'
  const secondImportedId = '10000000-0000-4000-8000-000000000003'
  const thirdImportedId = '10000000-0000-4000-8000-000000000004'
  const fourthImportedId = '10000000-0000-4000-8000-000000000005'
  const futureVersion = '2099-01-01T00:00:00.000Z'

  function insertTransaction(
    database: TestDatabase,
    id: string,
    { imported = false, payee = id }: { imported?: boolean; payee?: string } = {},
  ) {
    database.raw.prepare(`
      INSERT INTO transactions(
        id, type, amount_minor, currency, account_id, category_id, occurred_on,
        cleared, payee, note, created_at, updated_at, import_review_status
      ) VALUES (?, 'expense', 1000, 'HKD', 1, 1, '2026-07-14', 0, ?, '', ?, ?, ?)
    `).run(id, payee, futureVersion, futureVersion, imported ? 'unreviewed' : null)
    if (imported) {
      database.raw.prepare(`
        INSERT INTO transaction_import_keys(import_key, transaction_id) VALUES (?, ?)
      `).run(`csv:hushledger:id:${id}`, id)
    }
  }

  function reviewInput(ids: readonly string[], staleId?: string) {
    return {
      status: 'reviewed' as const,
      transactions: ids.map((id) => ({
        id,
        updatedAt: id === staleId ? '2098-01-01T00:00:00.000Z' : futureVersion,
      })),
    }
  }

  describe('import review mutations', () => {
    it('updates every imported row atomically with monotonic versions', async () => {
      const database = new TestDatabase()
      try {
        insertTransaction(database, importedId, { imported: true })
        insertTransaction(database, secondImportedId, { imported: true })
        const result = await setTransactionsImportReviewStatus(
          database as unknown as D1Database,
          reviewInput([importedId, secondImportedId]),
        )

        assert.deepEqual(result, { kind: 'updated', count: 2 })
        assert.deepEqual(plainRows(database.raw.prepare(`
          SELECT import_review_status AS status, updated_at AS updatedAt
          FROM transactions ORDER BY id
        `).all()), [
          { status: 'reviewed', updatedAt: '2099-01-01T00:00:00.001Z' },
          { status: 'reviewed', updatedAt: '2099-01-01T00:00:00.001Z' },
        ])
      } finally {
        database.close()
      }
    })

    for (const [label, setup] of [
      ['manual row', (database: TestDatabase) => {
        insertTransaction(database, manualId)
        insertTransaction(database, importedId, { imported: true })
        return reviewInput([manualId, importedId])
      }],
      ['NULL row carrying an import tombstone', (database: TestDatabase) => {
        insertTransaction(database, manualId)
        database.raw.prepare(`
          INSERT INTO transaction_import_keys(import_key, transaction_id) VALUES (?, ?)
        `).run(`csv:hushledger:id:${manualId}`, manualId)
        return reviewInput([manualId])
      }],
      ['stale imported row', (database: TestDatabase) => {
        insertTransaction(database, importedId, { imported: true })
        insertTransaction(database, secondImportedId, { imported: true })
        return reviewInput([importedId, secondImportedId], secondImportedId)
      }],
    ] as const) {
      it(`fails closed without partial writes for a ${label}`, async () => {
        const database = new TestDatabase()
        try {
          const input = setup(database)
          const before = plainRows(database.raw.prepare(`
            SELECT import_review_status AS status, updated_at AS updatedAt
            FROM transactions ORDER BY id
          `).all())
          const result = await setTransactionsImportReviewStatus(
            database as unknown as D1Database,
            input,
          )

          assert.deepEqual(result, { kind: 'version_conflict' })
          assert.deepEqual(plainRows(database.raw.prepare(`
            SELECT import_review_status AS status, updated_at AS updatedAt
            FROM transactions ORDER BY id
          `).all()), before)
        } finally {
          database.close()
        }
      })
    }

    it('filters the transaction API view by an exact import review state', async () => {
      const database = new TestDatabase()
      try {
        insertTransaction(database, manualId)
        insertTransaction(database, importedId, { imported: true })
        database.raw.prepare(`
          UPDATE transactions SET import_review_status = 'needs_follow_up' WHERE id = ?
        `).run(importedId)

        const transactions = await listTransactions(database as unknown as D1Database, {
          month: '2026-07',
          scope: 'month',
          importReviewStatus: 'needs_follow_up',
        })
        assert.equal(transactions.length, 1)
        assert.equal(transactions[0]?.id, importedId)
        assert.equal(transactions[0]?.importReviewStatus, 'needs_follow_up')
      } finally {
        database.close()
      }
    })
  })

  describe('transaction import review provenance', () => {
    it('requires explicit inclusion for later same-economic rows in one batch', async () => {
      const database = new TestDatabase()
      try {
        const rows: TransactionImportRow[] = [importedId, secondImportedId].map((id, index) => ({
          id,
          type: 'expense',
          amountMinor: 2500,
          currency: 'HKD',
          accountId: 1,
          categoryId: 1,
          occurredOn: '2026-07-14',
          cleared: true,
          payee: 'Repeated statement charge',
          note: '',
          sourceRow: index + 1,
          importKey: `csv:hushledger:id:${id}`,
          include: true,
        }))

        const preview = await previewTransactionImport(database as unknown as D1Database, rows)
        assert.deepEqual(preview.rows.map((row) => row.status), ['new', 'possible_duplicate'])
        assert.equal(preview.rows.filter(
          (row) => row.status === 'new' || row.status === 'match_ready',
        ).length, 1)

        const outcome = await commitTransactionImport(database as unknown as D1Database, rows)
        assert.equal(outcome.kind, 'committed')
        if (outcome.kind === 'committed') {
          assert.equal(outcome.result.imported, 2)
          assert.deepEqual(
            outcome.result.rows.map((row) => row.status),
            ['new', 'possible_duplicate'],
          )
        }
      } finally {
        database.close()
      }
    })

    it('uses stable statement source fields only for drifted AI siblings', async () => {
      const database = new TestDatabase()
      try {
        database.raw.exec(`
          INSERT INTO categories VALUES (2, 'Income', NULL, 'wallet', '#654321', 'income', 1)
        `)
        const aiRows: TransactionImportRow[] = [
          {
            id: importedId,
            type: 'expense',
            amountMinor: 2500,
            currency: 'HKD',
            accountId: 1,
            categoryId: 1,
            occurredOn: '2026-07-14',
            cleared: true,
            payee: 'Merchant name',
            note: '',
            sourceRow: 7,
            importKey: `ai:statement:row:${'a'.repeat(64)}`,
            include: true,
          },
          {
            id: secondImportedId,
            type: 'income',
            amountMinor: 2500,
            currency: 'HKD',
            accountId: 1,
            categoryId: 2,
            occurredOn: '2026-07-15',
            cleared: true,
            payee: 'Merchant Name Limited',
            note: 'AI wording drift',
            sourceRow: 7,
            importKey: `ai:statement:row:${'b'.repeat(64)}`,
            include: true,
          },
        ]

        const aiPreview = await previewTransactionImport(
          database as unknown as D1Database,
          aiRows,
        )
        assert.deepEqual(aiPreview.rows.map((row) => row.status), ['new', 'possible_duplicate'])
        const outcome = await commitTransactionImport(database as unknown as D1Database, aiRows)
        assert.equal(outcome.kind, 'committed')
        if (outcome.kind === 'committed') {
          assert.equal(outcome.result.imported, 2)
          assert.deepEqual(
            outcome.result.rows.map((row) => row.status),
            ['new', 'possible_duplicate'],
          )
        }

        const csvRows: TransactionImportRow[] = [
          {
            ...aiRows[0],
            id: thirdImportedId,
            amountMinor: 3000,
            payee: 'First legitimate CSV row',
            sourceRow: 8,
            importKey: `csv:hushledger:id:${thirdImportedId}`,
          },
          {
            ...aiRows[1],
            id: fourthImportedId,
            amountMinor: 3000,
            payee: 'Second legitimate CSV row',
            sourceRow: 8,
            importKey: `csv:hushledger:id:${fourthImportedId}`,
          },
        ]
        const csvPreview = await previewTransactionImport(
          database as unknown as D1Database,
          csvRows,
        )
        assert.deepEqual(csvPreview.rows.map((row) => row.status), ['new', 'new'])
      } finally {
        database.close()
      }
    })

    it('marks both new and matched statement rows as unreviewed', async () => {
      const database = new TestDatabase()
      try {
        insertTransaction(database, manualId, { payee: 'Existing card charge' })
        const rows: TransactionImportRow[] = [
          {
            id: importedId,
            type: 'expense',
            amountMinor: 2500,
            currency: 'HKD',
            accountId: 1,
            categoryId: 1,
            occurredOn: '2026-07-14',
            cleared: true,
            payee: 'New statement charge',
            note: '',
            sourceRow: 1,
            importKey: `csv:hushledger:id:${importedId}`,
            include: true,
          },
          {
            id: secondImportedId,
            type: 'expense',
            amountMinor: 1000,
            currency: 'HKD',
            accountId: 1,
            categoryId: 1,
            occurredOn: '2026-07-14',
            cleared: true,
            payee: 'Existing card charge',
            note: '',
            sourceRow: 2,
            importKey: `csv:hushledger:id:${secondImportedId}`,
            include: true,
          },
        ]

        const outcome = await commitTransactionImport(database as unknown as D1Database, rows)
        assert.equal(outcome.kind, 'committed')
        if (outcome.kind === 'committed') {
          assert.equal(outcome.result.imported, 1)
          assert.equal(outcome.result.matched, 1)
        }
        assert.deepEqual(plainRows(database.raw.prepare(`
          SELECT id, cleared, import_review_status AS status
          FROM transactions ORDER BY id
        `).all()), [
          { id: manualId, cleared: 1, status: 'unreviewed' },
          { id: importedId, cleared: 1, status: 'unreviewed' },
        ])
      } finally {
        database.close()
      }
    })

    it('keeps a deleted import tombstone from being reused as a manual transaction ID', async () => {
      const database = new TestDatabase()
      try {
        const row: TransactionImportRow = {
          id: importedId,
          type: 'expense',
          amountMinor: 2500,
          currency: 'HKD',
          accountId: 1,
          categoryId: 1,
          occurredOn: '2026-07-14',
          cleared: true,
          payee: 'Imported then deleted',
          note: '',
          sourceRow: 1,
          importKey: `csv:hushledger:id:${importedId}`,
          include: true,
        }
        const outcome = await commitTransactionImport(
          database as unknown as D1Database,
          [row],
        )
        assert.equal(outcome.kind, 'committed')
        const imported = database.raw.prepare(`
          SELECT updated_at AS updatedAt FROM transactions WHERE id = ?
        `).get(importedId) as { updatedAt: string }

        assert.deepEqual(
          await deleteTransaction(
            database as unknown as D1Database,
            importedId,
            imported.updatedAt,
          ),
          { kind: 'deleted', id: importedId },
        )
        assert.deepEqual(
          await createTransaction(database as unknown as D1Database, {
            id: importedId,
            type: 'expense',
            amountMinor: 2500,
            currency: 'HKD',
            accountId: 1,
            categoryId: 1,
            occurredOn: '2026-07-14',
            cleared: false,
            payee: 'Manual UUID reuse',
            note: '',
          }),
          { kind: 'id_conflict' },
        )
        assert.equal(
          database.raw.prepare('SELECT COUNT(*) AS count FROM transactions').get()?.count,
          0,
        )
      } finally {
        database.close()
      }
    })
  })
}
