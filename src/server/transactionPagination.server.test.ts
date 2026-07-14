import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  TRANSACTION_PAGE_SIZE,
  type Transaction,
  type TransactionPageCursor,
  type TransactionSort,
} from '../lib/schema'

type Row = Record<string, unknown>
type BatchResult<T> = {
  success: true
  results: T[]
  meta: { changes: number }
}

const childRun = process.env.HUSHL_TRANSACTION_PAGINATION_SERVER_TEST === '1'

if (!childRun) {
  describe('transaction pagination server-only checks', () => {
    it('runs the SQLite contract under React server conditions', () => {
      const environment: NodeJS.ProcessEnv = {
        ...process.env,
        HUSHL_TRANSACTION_PAGINATION_SERVER_TEST: '1',
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
  const { listTransactionPage } = await import('./money')

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
      return { success: true, results: rows, meta: { changes: 0 } }
    }

    async first<T extends Row>(): Promise<T | null> {
      return (this.database.raw.prepare(this.sql).get(...this.values) as T | undefined) ?? null
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

    close() {
      this.raw.close()
    }
  }

  const TEST_SCHEMA = `
    CREATE TABLE accounts (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      localization_key TEXT
    );
    CREATE TABLE categories (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      localization_key TEXT,
      icon TEXT NOT NULL,
      color TEXT NOT NULL
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
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO accounts VALUES (1, 'Checking', NULL);
    INSERT INTO categories VALUES (1, 'Food', NULL, 'utensils', '#123456');
  `

  const revision = 77
  const sorts: TransactionSort[] = [
    'date_desc',
    'date_asc',
    'amount_desc',
    'amount_asc',
    'payee_asc',
    'payee_desc',
  ]

  function transactionId(index: number) {
    return `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`
  }

  function insertTransaction(
    database: TestDatabase,
    index: number,
    overrides: Partial<Pick<Transaction, 'amountMinor' | 'occurredOn' | 'payee' | 'createdAt'>> = {},
  ) {
    const occurredOn = overrides.occurredOn ?? `2026-07-${String((index % 28) + 1).padStart(2, '0')}`
    const createdAt = overrides.createdAt
      ?? `2026-07-${String((index % 28) + 1).padStart(2, '0')}T${String(index % 24).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}:00.000Z`
    database.raw.prepare(`
      INSERT INTO transactions(
        id, type, amount_minor, currency, account_id, category_id, occurred_on,
        cleared, payee, note, created_at, updated_at
      ) VALUES (?, 'expense', ?, 'HKD', 1, 1, ?, 0, ?, '', ?, ?)
    `).run(
      transactionId(index),
      overrides.amountMinor ?? ((index * 37) % 997) + 1,
      occurredOn,
      overrides.payee ?? (index % 11 === 0 ? '' : ['Alpha', 'beta', 'Gamma'][index % 3]!),
      createdAt,
      createdAt,
    )
  }

  function asciiCompare(left: string, right: string) {
    const a = left.toLowerCase()
    const b = right.toLowerCase()
    return a < b ? -1 : a > b ? 1 : 0
  }

  function descending(left: string | number, right: string | number) {
    return left < right ? 1 : left > right ? -1 : 0
  }

  function ascending(left: string | number, right: string | number) {
    return left < right ? -1 : left > right ? 1 : 0
  }

  function expectedOrder(sort: TransactionSort, rows: readonly Transaction[]) {
    return [...rows].sort((left, right) => {
      if (sort === 'date_desc') {
        return descending(left.occurredOn, right.occurredOn)
          || descending(left.createdAt, right.createdAt)
          || descending(left.id, right.id)
      }
      if (sort === 'date_asc') {
        return ascending(left.occurredOn, right.occurredOn)
          || ascending(left.createdAt, right.createdAt)
          || ascending(left.id, right.id)
      }
      if (sort === 'amount_desc' || sort === 'amount_asc') {
        const amountOrder = sort === 'amount_desc' ? descending : ascending
        return amountOrder(left.amountMinor, right.amountMinor)
          || descending(left.occurredOn, right.occurredOn)
          || descending(left.createdAt, right.createdAt)
          || descending(left.id, right.id)
      }
      const leftBlank = left.payee.trim() === '' ? 1 : 0
      const rightBlank = right.payee.trim() === '' ? 1 : 0
      const payeeOrder = asciiCompare(left.payee, right.payee) * (sort === 'payee_asc' ? 1 : -1)
      return ascending(leftBlank, rightBlank)
        || payeeOrder
        || descending(left.occurredOn, right.occurredOn)
        || descending(left.createdAt, right.createdAt)
        || descending(left.id, right.id)
    })
  }

  async function collectPages(database: TestDatabase, sort: TransactionSort, payee?: string) {
    const rows: Transaction[] = []
    const sizes: number[] = []
    let cursor: TransactionPageCursor | undefined
    for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
      const page = await listTransactionPage(database as unknown as D1Database, {
        month: '2026-07',
        scope: 'month',
        sort,
        ...(payee ? { payee } : {}),
        ...(cursor ? { cursor } : {}),
      }, revision)
      rows.push(...page.transactions)
      sizes.push(page.transactions.length)
      cursor = page.nextCursor ?? undefined
      if (!cursor) return { rows, sizes }
    }
    throw new Error('pagination did not terminate')
  }

  describe('transaction keyset pagination', () => {
    for (const sort of sorts) {
      it(`returns every row exactly once for ${sort}`, async () => {
        const database = new TestDatabase()
        try {
          for (let index = 1; index <= 405; index += 1) insertTransaction(database, index)
          const unpaged = await listTransactionPage(database as unknown as D1Database, {
            month: '2026-07',
            scope: 'month',
            sort,
          }, revision)
          assert.equal(TRANSACTION_PAGE_SIZE, 200)
          assert.equal(unpaged.transactions.length, 200)
          assert.equal(unpaged.nextCursor?.revision, revision)
          assert.equal(unpaged.nextCursor?.sort, sort)

          const { rows, sizes } = await collectPages(database, sort)
          assert.deepEqual(sizes, [200, 200, 5])
          assert.equal(rows.length, 405)
          assert.equal(new Set(rows.map(({ id }) => id)).size, 405)
          assert.deepEqual(
            rows.map(({ id }) => id),
            expectedOrder(sort, rows).map(({ id }) => id),
          )
        } finally {
          database.close()
        }
      })
    }

    it('rejects direct cursor reuse against another snapshot or filter', async () => {
      const database = new TestDatabase()
      try {
        for (let index = 1; index <= 205; index += 1) insertTransaction(database, index)
        const first = await listTransactionPage(database as unknown as D1Database, {
          month: '2026-07',
          scope: 'month',
          sort: 'date_desc',
        }, revision)
        assert(first.nextCursor)
        await assert.rejects(() => listTransactionPage(database as unknown as D1Database, {
          month: '2026-07',
          scope: 'month',
          sort: 'date_desc',
          cursor: first.nextCursor!,
        }, revision + 1), /snapshot or query/)
        await assert.rejects(() => listTransactionPage(database as unknown as D1Database, {
          month: '2026-07',
          scope: 'month',
          sort: 'date_desc',
          search: 'different',
          cursor: first.nextCursor!,
        }, revision), /snapshot or query/)
      } finally {
        database.close()
      }
    })

    for (const sort of ['payee_asc', 'payee_desc'] as const) {
      it(`paginates normalized Unicode exact-payee matches without skipping ${sort} candidates`, async () => {
        const database = new TestDatabase()
        try {
          for (let index = 1; index <= 430; index += 1) {
            const matching = index % 2 === 0 || index <= 10
            insertTransaction(database, index, {
              payee: matching
                ? index % 4 === 0 ? 'E\u0301PICERIE' : 'ÉPICERIE'
                : `Other ${String(index).padStart(3, '0')}`,
            })
          }
          const { rows, sizes } = await collectPages(database, sort, ' épicerie ')
          assert.deepEqual(sizes, [200, 20])
          assert.equal(rows.length, 220)
          assert.equal(new Set(rows.map(({ id }) => id)).size, 220)
          assert(rows.every(({ payee }) => payee.normalize('NFC').toLowerCase() === 'épicerie'))
        } finally {
          database.close()
        }
      })
    }

    for (const sort of ['payee_asc', 'payee_desc'] as const) {
      it(`keeps blank payees last across the ${sort} page boundary`, async () => {
        const database = new TestDatabase()
        try {
          for (let index = 1; index <= 205; index += 1) {
            insertTransaction(database, index, { payee: index <= 199 ? 'Same payee' : '   ' })
          }
          const { rows, sizes } = await collectPages(database, sort)
          assert.deepEqual(sizes, [200, 5])
          assert(rows.slice(0, 199).every(({ payee }) => payee === 'Same payee'))
          assert(rows.slice(199).every(({ payee }) => payee.trim() === ''))
        } finally {
          database.close()
        }
      })
    }

    for (const sort of sorts) {
      it(`uses the unique id tie-breaker across the ${sort} page boundary`, async () => {
        const database = new TestDatabase()
        try {
          for (let index = 1; index <= 205; index += 1) {
            insertTransaction(database, index, {
              amountMinor: 500,
              occurredOn: '2026-07-15',
              payee: 'Same payee',
              createdAt: '2026-07-15T12:00:00.000Z',
            })
          }
          const { rows, sizes } = await collectPages(database, sort)
          assert.deepEqual(sizes, [200, 5])
          const expectedIds = Array.from({ length: 205 }, (_, index) => transactionId(index + 1))
          if (sort !== 'date_asc') expectedIds.reverse()
          assert.deepEqual(rows.map(({ id }) => id), expectedIds)
        } finally {
          database.close()
        }
      })
    }
  })
}
