import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { it } from 'node:test'
import { fileURLToPath } from 'node:url'

if (process.env.HUSH_LEDGER_INTEGRITY_TEST !== '1') {
  it('preserves accented-name backups and rejects same-millisecond stale writes', () => {
    const env = { ...process.env, HUSH_LEDGER_INTEGRITY_TEST: '1' }
    delete (env as NodeJS.ProcessEnv).NODE_TEST_CONTEXT
    const result = spawnSync(process.execPath, [
      '--conditions=react-server', '--import', 'tsx', '--test', fileURLToPath(import.meta.url),
    ], { env, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stdout + result.stderr)
  })
} else {
  const { createAccountReference, createCategoryReference } = await import('./referenceData')
  const { exportLedgerBackup, verifyLedgerBackup } = await import('./ledgerBackup')
  const { createTransaction, updateTransaction, deleteTransaction, getTransaction } = await import('./money')
  const { createAccountTransfer, updateAccountTransfer, deleteAccountTransfer, getAccountTransfer } = await import('./transfers')

  class Statement {
    constructor(readonly raw: DatabaseSync, readonly sql: string, readonly values: SQLInputValue[] = []) {}
    bind(...values: SQLInputValue[]) { return new Statement(this.raw, this.sql, values) }
    async first() { return this.raw.prepare(this.sql).get(...this.values) ?? null }
    async all() { return { success: true, results: this.raw.prepare(this.sql).all(...this.values), meta: { changes: 0 } } }
    async run() { return { success: true, results: [], meta: { changes: Number(this.raw.prepare(this.sql).run(...this.values).changes) } } }
  }
  class Database {
    readonly raw = new DatabaseSync(':memory:')
    readonly clock = new DatabaseSync(':memory:')
    now = '2026-10-26T06:00:00.123Z'
    constructor() {
      for (const name of readdirSync(new URL('../../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) {
        this.raw.exec(readFileSync(new URL('../../migrations/' + name, import.meta.url), 'utf8'))
      }
      this.raw.function('strftime', { varargs: true }, (...args: SQLInputValue[]) => {
        if (args[0] === '%Y-%m-%dT%H:%M:%fZ' && args[1] === 'now') return this.now
        return this.clock.prepare(`SELECT strftime(${args.map(() => '?').join(',')}) AS value`).get(...args)?.value ?? null
      })
    }
    prepare(sql: string) { return new Statement(this.raw, sql) }
    async batch(statements: Statement[]) {
      this.raw.exec('BEGIN')
      try {
        const results = []
        for (const statement of statements) results.push(/^\s*(SELECT|WITH)|RETURNING/i.test(statement.sql) ? await statement.all() : await statement.run())
        this.raw.exec('COMMIT')
        return results
      } catch (error) { this.raw.exec('ROLLBACK'); throw error }
    }
    get d1() { return this as unknown as D1Database }
    close() { this.raw.close(); this.clock.close() }
  }

  for (const kind of ['account', 'category'] as const) {
    it(`exports and verifies distinct accented ${kind} names with SQLite NOCASE semantics`, async () => {
      const db = new Database()
      try {
        const names = kind === 'account' ? ['Épargne', 'épargne'] : ['Épicerie', 'épicerie']
        const create = (name: string) => kind === 'account'
          ? createAccountReference(db.d1, { name, type: 'bank', currency: 'HKD', expectedCurrency: 'HKD', openingBalanceMinor: null, openingBalanceOn: null })
          : createCategoryReference(db.d1, { name, type: 'expense', expectedCurrency: 'HKD', monthlyPlanMinor: null })
        for (const name of names) assert.equal((await create(name)).kind, 'created')
        assert.equal((await create(names[0].toUpperCase())).kind, 'name_conflict')
        const backup = await exportLedgerBackup(db.d1)
        assert.equal((await verifyLedgerBackup(backup)).ok, true)
        const rows = kind === 'account' ? backup.data.accounts : backup.data.categories
        for (const name of names) assert(rows.some(row => row.name === name))
      } finally { db.close() }
    })
  }

  it('advances transaction versions within one millisecond and after the clock moves backward', async () => {
    const db = new Database()
    try {
      const input = { id: '10000000-0000-4000-8000-000000000001', type: 'expense' as const, amountMinor: 100, currency: 'HKD' as const, accountId: 1, categoryId: 3, occurredOn: '2026-10-20', cleared: true, payee: 'Fictional merchant', note: '' }
      const created = await createTransaction(db.d1, input)
      assert.equal(created.kind, 'created')
      const original = await getTransaction(db.d1, input.id)
      assert(original)
      const first = await updateTransaction(db.d1, input.id, { ...input, amountMinor: 200, updatedAt: original.updatedAt })
      assert.equal(first.kind, 'updated')
      const current = await getTransaction(db.d1, input.id)
      assert(current)
      assert.equal(current.updatedAt, '2026-10-26T06:00:00.124Z')
      assert.equal((await updateTransaction(db.d1, input.id, { ...input, amountMinor: 300, updatedAt: original.updatedAt })).kind, 'version_conflict')
      assert.equal((await deleteTransaction(db.d1, input.id, original.updatedAt)).kind, 'version_conflict')
      assert.equal((await getTransaction(db.d1, input.id))?.amountMinor, 200)
      db.now = '2026-10-26T05:00:00.000Z'
      assert.equal((await updateTransaction(db.d1, input.id, { ...input, amountMinor: 400, updatedAt: current.updatedAt })).kind, 'updated')
      assert.equal((await getTransaction(db.d1, input.id))?.updatedAt, '2026-10-26T06:00:00.125Z')
    } finally { db.close() }
  })

  it('rejects stale transfer updates and deletes after same-millisecond edits', async () => {
    const db = new Database()
    try {
      const input = { id: '10000000-0000-4000-8000-000000000002', amountMinor: 100, currency: 'HKD' as const, fromAccountId: 1, toAccountId: 2, occurredOn: '2026-10-20', fromCleared: true, toCleared: true, note: '' }
      assert.equal((await createAccountTransfer(db.d1, input)).kind, 'created')
      const original = await getAccountTransfer(db.d1, input.id)
      assert(original)
      assert.equal((await updateAccountTransfer(db.d1, input.id, { ...input, amountMinor: 200, updatedAt: original.updatedAt })).kind, 'updated')
      assert.equal((await getAccountTransfer(db.d1, input.id))?.updatedAt, '2026-10-26T06:00:00.124Z')
      assert.equal((await updateAccountTransfer(db.d1, input.id, { ...input, amountMinor: 300, updatedAt: original.updatedAt })).kind, 'version_conflict')
      assert.equal((await deleteAccountTransfer(db.d1, input.id, original.updatedAt)).kind, 'version_conflict')
      assert.equal((await getAccountTransfer(db.d1, input.id))?.amountMinor, 200)
    } finally { db.close() }
  })
}
