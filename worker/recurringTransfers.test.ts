import assert from 'node:assert/strict'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { describe, it } from 'node:test'
import type {
  RecurringTransferRuleCreateInput,
  RecurringTransferRuleUpdateInput,
} from '../src/lib/schema'
import {
  createRecurringTransferRule,
  runDueRecurringTransferRules,
  updateRecurringTransferRule,
} from './recurringTransfers'

type Row = Record<string, unknown>

type BatchResult<T> = {
  success: true
  results: T[]
  meta: { changes: number }
}

class TestStatement {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
    private readonly values: SQLInputValue[] = [],
    private readonly beforeRun: () => void = () => undefined,
  ) {}

  bind(...values: SQLInputValue[]) {
    return new TestStatement(this.database, this.sql, values, this.beforeRun)
  }

  async all<T extends Row>(): Promise<BatchResult<T>> {
    const results = this.database.prepare(this.sql).all(...this.values) as T[]
    return { success: true, results, meta: { changes: 0 } }
  }

  async first<T extends Row>(): Promise<T | null> {
    return (this.database.prepare(this.sql).get(...this.values) as T | undefined) ?? null
  }

  async run(): Promise<BatchResult<never>> {
    this.beforeRun()
    const result = this.database.prepare(this.sql).run(...this.values)
    return { success: true, results: [], meta: { changes: Number(result.changes) } }
  }
}

class TestDatabase {
  readonly raw = new DatabaseSync(':memory:')
  private beforeBatch: (() => void) | null = null
  private beforeRun: (() => void) | null = null

  constructor() {
    this.raw.exec(TEST_SCHEMA)
  }

  prepare(sql: string) {
    return new TestStatement(this.raw, sql, [], () => {
      const operation = this.beforeRun
      this.beforeRun = null
      operation?.()
    })
  }

  runBeforeNextBatch(operation: () => void) {
    this.beforeBatch = operation
  }

  runBeforeNextStatement(operation: () => void) {
    this.beforeRun = operation
  }

  async batch<T>(statements: D1PreparedStatement[]) {
    const operation = this.beforeBatch
    this.beforeBatch = null
    operation?.()

    this.raw.exec('BEGIN')
    try {
      const results: BatchResult<T>[] = []
      for (const statement of statements as unknown as TestStatement[]) {
        results.push(await statement.all<T & Row>() as BatchResult<T>)
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
  PRAGMA foreign_keys = ON;
  CREATE TABLE accounts (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    currency TEXT NOT NULL,
    is_active INTEGER NOT NULL,
    opening_balance_on TEXT
  );
  CREATE TABLE recurring_transfer_rules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    amount_minor INTEGER NOT NULL,
    currency TEXT NOT NULL,
    from_account_id INTEGER NOT NULL REFERENCES accounts(id),
    to_account_id INTEGER NOT NULL REFERENCES accounts(id),
    frequency TEXT NOT NULL,
    schedule_starts_on TEXT NOT NULL,
    schedule_ends_on TEXT,
    next_occurrence_on TEXT NOT NULL,
    last_occurrence_on TEXT,
    anchor_day INTEGER NOT NULL,
    is_active INTEGER NOT NULL,
    note TEXT NOT NULL,
    generated_count INTEGER NOT NULL DEFAULT 0,
    last_error_code TEXT,
    last_error_at TEXT,
    revision INTEGER NOT NULL DEFAULT 1,
    cursor_version INTEGER NOT NULL DEFAULT 1,
    deleted_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK(from_account_id <> to_account_id)
  );
  CREATE TABLE account_transfers (
    id TEXT PRIMARY KEY,
    amount_minor INTEGER NOT NULL,
    currency TEXT NOT NULL,
    from_account_id INTEGER NOT NULL REFERENCES accounts(id),
    to_account_id INTEGER NOT NULL REFERENCES accounts(id),
    occurred_on TEXT NOT NULL,
    from_cleared INTEGER NOT NULL,
    to_cleared INTEGER NOT NULL,
    note TEXT NOT NULL,
    recurring_transfer_rule_id TEXT REFERENCES recurring_transfer_rules(id),
    recurring_transfer_rule_name TEXT,
    recurrence_due_on TEXT,
    recurring_occurrence_key TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
`

const RULE_ID = '10000000-0000-4000-8000-000000000001'

const baseRule: RecurringTransferRuleCreateInput = {
  id: RULE_ID,
  name: 'Emergency savings',
  amountMinor: 50_000,
  currency: 'HKD',
  fromAccountId: 1,
  toAccountId: 2,
  frequency: 'monthly',
  scheduleStartsOn: '2026-01-01',
  scheduleEndsOn: null,
  isActive: true,
  note: 'Monthly savings',
}

function d1(database: TestDatabase) {
  return database as unknown as D1Database
}

function seedAccounts(
  database: TestDatabase,
  fromOpeningOn: string | null = null,
  toOpeningOn: string | null = null,
) {
  const insert = database.raw.prepare(`
    INSERT INTO accounts(id, name, currency, is_active, opening_balance_on)
    VALUES (?, ?, 'HKD', 1, ?)
  `)
  insert.run(1, 'Everyday', fromOpeningOn)
  insert.run(2, 'Savings', toOpeningOn)
}

async function seedRule(database: TestDatabase, patch: Partial<RecurringTransferRuleCreateInput> = {}) {
  const result = await createRecurringTransferRule(
    d1(database),
    { ...baseRule, ...patch },
    '2026-01-01',
  )
  assert.equal(result.kind, 'created')
}

function ruleCursor(database: TestDatabase) {
  return database.raw.prepare(`
    SELECT
      next_occurrence_on AS nextOccurrenceOn,
      generated_count AS generatedCount,
      revision,
      cursor_version AS cursorVersion,
      is_active AS isActive,
      deleted_at AS deletedAt,
      last_error_code AS lastErrorCode
    FROM recurring_transfer_rules
    WHERE id = ?
  `).get(RULE_ID) as {
    nextOccurrenceOn: string
    generatedCount: number
    revision: number
    cursorVersion: number
    isActive: number
    deletedAt: string | null
    lastErrorCode: string | null
  }
}

function transferRows(database: TestDatabase) {
  return database.raw.prepare(`
    SELECT
      amount_minor AS amountMinor,
      from_account_id AS fromAccountId,
      to_account_id AS toAccountId,
      occurred_on AS occurredOn,
      from_cleared AS fromCleared,
      to_cleared AS toCleared,
      recurring_transfer_rule_id AS recurringTransferRuleId,
      recurring_transfer_rule_name AS recurringTransferRuleName,
      recurrence_due_on AS recurrenceDueOn,
      recurring_occurrence_key AS recurringOccurrenceKey
    FROM account_transfers
    ORDER BY recurrence_due_on
  `).all() as Array<{
    amountMinor: number
    fromAccountId: number
    toAccountId: number
    occurredOn: string
    fromCleared: number
    toCleared: number
    recurringTransferRuleId: string
    recurringTransferRuleName: string
    recurrenceDueOn: string
    recurringOccurrenceKey: string
  }>
}

describe('recurring transfer generation concurrency', () => {
  it('treats the schedule start as the canonical first date for same-ID replays', async () => {
    const database = new TestDatabase()
    try {
      seedAccounts(database)
      await seedRule(database)

      const replay = await createRecurringTransferRule(d1(database), {
        ...baseRule,
        scheduleStartsOn: '2026-02-01',
      }, '2026-01-01')

      assert.equal(replay.kind, 'id_conflict')
      assert.equal(ruleCursor(database).nextOccurrenceOn, '2026-01-01')
    } finally {
      database.close()
    }
  })

  it('lets edit, pause, delete, and exact-next changes beat a stale plan before INSERT', async () => {
    const races = [
      {
        name: 'edit',
        mutate: (database: TestDatabase) => database.raw.prepare(`
          UPDATE recurring_transfer_rules
          SET amount_minor = 60000, revision = revision + 1, cursor_version = cursor_version + 1
          WHERE id = ?
        `).run(RULE_ID),
        assertWinner: (row: ReturnType<typeof ruleCursor>) => {
          assert.equal(row.revision, 2)
          assert.equal(row.cursorVersion, 2)
          assert.equal(row.isActive, 1)
        },
      },
      {
        name: 'pause',
        mutate: (database: TestDatabase) => database.raw.prepare(`
          UPDATE recurring_transfer_rules
          SET is_active = 0, revision = revision + 1, cursor_version = cursor_version + 1
          WHERE id = ?
        `).run(RULE_ID),
        assertWinner: (row: ReturnType<typeof ruleCursor>) => assert.equal(row.isActive, 0),
      },
      {
        name: 'delete',
        mutate: (database: TestDatabase) => database.raw.prepare(`
          UPDATE recurring_transfer_rules
          SET is_active = 0, deleted_at = '2026-01-01T00:00:00.000Z',
              revision = revision + 1, cursor_version = cursor_version + 1
          WHERE id = ?
        `).run(RULE_ID),
        assertWinner: (row: ReturnType<typeof ruleCursor>) => {
          assert.equal(row.isActive, 0)
          assert.equal(row.deletedAt, '2026-01-01T00:00:00.000Z')
        },
      },
      {
        name: 'exact next occurrence',
        mutate: (database: TestDatabase) => database.raw.prepare(`
          UPDATE recurring_transfer_rules SET next_occurrence_on = '2026-02-01' WHERE id = ?
        `).run(RULE_ID),
        assertWinner: (row: ReturnType<typeof ruleCursor>) => {
          assert.equal(row.nextOccurrenceOn, '2026-02-01')
          assert.equal(row.revision, 1)
          assert.equal(row.cursorVersion, 1)
        },
      },
    ]

    for (const race of races) {
      const database = new TestDatabase()
      try {
        seedAccounts(database)
        await seedRule(database)
        database.runBeforeNextBatch(() => race.mutate(database))

        const result = await runDueRecurringTransferRules(d1(database), '2026-01-01')

        assert.equal(transferRows(database).length, 0, `${race.name} inserted a stale transfer`)
        assert.equal(ruleCursor(database).generatedCount, 0)
        race.assertWinner(ruleCursor(database))
        assert.equal(result.created, 0)
      } finally {
        database.close()
      }
    }
  })

  it('advances the cursor only after every planned occurrence exists in the atomic batch', async () => {
    const database = new TestDatabase()
    try {
      seedAccounts(database)
      await seedRule(database)
      database.raw.exec(`
        CREATE TRIGGER ignore_second_occurrence
        BEFORE INSERT ON account_transfers
        WHEN NEW.recurrence_due_on = '2026-02-01'
        BEGIN
          SELECT RAISE(IGNORE);
        END;
      `)

      const partial = await runDueRecurringTransferRules(d1(database), '2026-02-01')
      assert.equal(partial.created, 1)
      assert.equal(partial.blocked, 1)
      assert.deepEqual(transferRows(database).map((row) => row.recurrenceDueOn), ['2026-01-01'])
      assert.equal(ruleCursor(database).nextOccurrenceOn, '2026-01-01')
      assert.equal(ruleCursor(database).generatedCount, 0)

      database.raw.exec('DROP TRIGGER ignore_second_occurrence')
      const completed = await runDueRecurringTransferRules(d1(database), '2026-02-01')
      assert.equal(completed.created, 1)
      assert.equal(completed.alreadyExisting, 1)
      assert.deepEqual(transferRows(database).map((row) => row.recurrenceDueOn), [
        '2026-01-01',
        '2026-02-01',
      ])
      assert.equal(ruleCursor(database).nextOccurrenceOn, '2026-03-01')
      assert.equal(ruleCursor(database).generatedCount, 2)
    } finally {
      database.close()
    }
  })

  it('does not let a stale edit overwrite a generation cursor that won first', async () => {
    const database = new TestDatabase()
    try {
      seedAccounts(database)
      await seedRule(database)
      database.runBeforeNextStatement(() => database.raw.prepare(`
        UPDATE recurring_transfer_rules
        SET next_occurrence_on = '2026-02-01', cursor_version = cursor_version + 1
        WHERE id = ?
      `).run(RULE_ID))
      const { id, ...fields } = baseRule
      assert.equal(id, RULE_ID)

      const result = await updateRecurringTransferRule(d1(database), RULE_ID, {
        ...fields,
        amountMinor: 60_000,
        revision: 1,
      }, '2026-01-01')

      assert.equal(result.kind, 'version_conflict')
      const row = database.raw.prepare(`
        SELECT amount_minor AS amountMinor, next_occurrence_on AS nextOccurrenceOn
        FROM recurring_transfer_rules WHERE id = ?
      `).get(RULE_ID) as { amountMinor: number; nextOccurrenceOn: string }
      assert.deepEqual({ ...row }, { amountMinor: 50_000, nextOccurrenceOn: '2026-02-01' })
    } finally {
      database.close()
    }
  })
})

describe('recurring transfer accounting guards', () => {
  it('blocks a due occurrence before either account opening date without moving schedule cursor', async () => {
    for (const [fromOpeningOn, toOpeningOn] of [
      ['2026-01-02', null],
      [null, '2026-01-02'],
    ] as const) {
      const database = new TestDatabase()
      try {
        seedAccounts(database, fromOpeningOn, toOpeningOn)
        await seedRule(database)

        const result = await runDueRecurringTransferRules(d1(database), '2026-01-01')

        assert.equal(result.blocked, 1)
        assert.equal(result.created, 0)
        assert.equal(transferRows(database).length, 0)
        assert.equal(ruleCursor(database).nextOccurrenceOn, '2026-01-01')
        assert.equal(ruleCursor(database).generatedCount, 0)
        assert.equal(ruleCursor(database).lastErrorCode, 'ACCOUNT_OPENING_DATE_AFTER_DUE')
      } finally {
        database.close()
      }
    }
  })

  it('creates one uncleared native transfer with immutable occurrence provenance', async () => {
    const database = new TestDatabase()
    try {
      seedAccounts(database)
      await seedRule(database)

      const result = await runDueRecurringTransferRules(d1(database), '2026-01-01')
      const [transfer] = transferRows(database)

      assert.equal(result.created, 1)
      assert.deepEqual({ ...transfer }, {
        amountMinor: 50_000,
        fromAccountId: 1,
        toAccountId: 2,
        occurredOn: '2026-01-01',
        fromCleared: 0,
        toCleared: 0,
        recurringTransferRuleId: RULE_ID,
        recurringTransferRuleName: 'Emergency savings',
        recurrenceDueOn: '2026-01-01',
        recurringOccurrenceKey: `${RULE_ID}:2026-01-01`,
      })
      assert.equal(ruleCursor(database).nextOccurrenceOn, '2026-02-01')

      const retry = await runDueRecurringTransferRules(d1(database), '2026-01-01')
      assert.equal(retry.created, 0)
      assert.equal(transferRows(database).length, 1)
    } finally {
      database.close()
    }
  })

  it('rejects an old-client hidden-end conflict without writing', async () => {
    const database = new TestDatabase()
    try {
      seedAccounts(database)
      await seedRule(database, { scheduleEndsOn: '2026-01-31' })
      const before = database.raw.prepare(
        'SELECT * FROM recurring_transfer_rules WHERE id = ?',
      ).get(RULE_ID)
      const { id, scheduleEndsOn, ...fields } = baseRule
      assert.equal(id, RULE_ID)
      assert.equal(scheduleEndsOn, null)
      const update: RecurringTransferRuleUpdateInput = {
        ...fields,
        scheduleStartsOn: '2026-02-01',
        revision: 1,
      }

      const result = await updateRecurringTransferRule(
        d1(database),
        RULE_ID,
        update,
        '2026-01-01',
      )

      assert.equal(result.kind, 'version_conflict')
      const after = database.raw.prepare(
        'SELECT * FROM recurring_transfer_rules WHERE id = ?',
      ).get(RULE_ID)
      assert.deepEqual(after, before)
    } finally {
      database.close()
    }
  })
})
