import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { it } from 'node:test'
import { fileURLToPath } from 'node:url'
import type { PasteRow } from '../lib/pasteApproval'

if (process.env.HUSH_PASTE_TEST !== '1') {
  it('runs approval, retry, history, migration and undo contracts in a server context', () => {
    const env = { ...process.env, HUSH_PASTE_TEST: '1' }
    delete (env as NodeJS.ProcessEnv).NODE_TEST_CONTEXT
    const result = spawnSync(process.execPath, ['--conditions=react-server', '--import', 'tsx', '--test', fileURLToPath(import.meta.url)], { env, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stdout + result.stderr)
  })
} else {
  const { approvePaste, previewPaste, undoPaste, PasteConflict } = await import('./pasteApproval')
  const { listPayeeSuggestions, setTransactionsImportReviewStatus } = await import('./money')
  class Statement {
    constructor(readonly raw: DatabaseSync, readonly sql: string, readonly values: SQLInputValue[] = []) {}
    bind(...values: SQLInputValue[]) { return new Statement(this.raw, this.sql, values) }
    async first() { return this.raw.prepare(this.sql).get(...this.values) ?? null }
    async all() { return { success: true, results: this.raw.prepare(this.sql).all(...this.values), meta: { changes: 0 } } }
    async run() { return { success: true, results: [], meta: { changes: Number(this.raw.prepare(this.sql).run(...this.values).changes) } } }
  }
  class Database {
    readonly raw = new DatabaseSync(':memory:')
    constructor(last = '0022') {
      for (const name of readdirSync(new URL('../../migrations/', import.meta.url)).filter((name) => name.endsWith('.sql') && name.slice(0, 4) <= last).sort()) {
        this.raw.exec(readFileSync(new URL('../../migrations/' + name, import.meta.url), 'utf8'))
      }
    }
    prepare(sql: string) { return new Statement(this.raw, sql) }
    async batch(statements: Statement[]) {
      this.raw.exec('BEGIN')
      try {
        const result = []
        for (const statement of statements) result.push(/RETURNING|^\s*(SELECT|WITH)/i.test(statement.sql) ? await statement.all() : await statement.run())
        this.raw.exec('COMMIT')
        return result
      } catch (error) { this.raw.exec('ROLLBACK'); throw error }
    }
    get d1() { return this as unknown as D1Database }
  }
  function row(index: number, patch: Partial<PasteRow> = {}): PasteRow {
    return { id: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      importKey: `ai:statement:row:${index.toString(16).padStart(64, '0')}`, accountId: 1,
      categoryId: 3, currency: 'HKD', type: 'expense', occurredOn: '2026-10-20',
      amountMinor: 1234, payee: `Fictional merchant ${index}`, note: '', cleared: true,
      duplicateConfirmed: false, ...patch }
  }
  async function approve(db: Database, rows: PasteRow[], op = crypto.randomUUID()) {
    const preview = await previewPaste(db.d1, rows)
    return approvePaste(db.d1, op, preview.revision, rows)
  }
  function count(db: Database, table: string) { return Number(db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n) }

  it('preview writes nothing; only approved current versions influence the selected account', async () => {
    const db = new Database()
    try {
      await previewPaste(db.d1, [row(1)])
      assert.equal(count(db, 'transactions'), 0)
      await approve(db, [row(1)])
      assert.equal((await listPayeeSuggestions(db.d1, 1))[0].payee, 'Fictional merchant 1')
      assert.deepEqual(await listPayeeSuggestions(db.d1, 2), [])
      assert.deepEqual(await listPayeeSuggestions(db.d1), [])
      db.raw.prepare("UPDATE transactions SET payee = 'Correction', updated_at = '2026-10-23T12:00:00.001Z' WHERE id = ?").run(row(1).id)
      assert.deepEqual(await listPayeeSuggestions(db.d1, 1), [])
      assert.equal(count(db, 'transaction_approvals'), 0)
      await setTransactionsImportReviewStatus(db.d1, {
        transactions: [{ id: row(1).id, updatedAt: '2026-10-23T12:00:00.001Z' }], status: 'reviewed',
      })
      assert.equal((await listPayeeSuggestions(db.d1, 1))[0].payee, 'Correction')
    } finally { db.raw.close() }
  })
  it('retries return the same receipt and reject reuse with changed content', async () => {
    const db = new Database()
    try {
      const rows = [row(1), row(2)]
      const op = crypto.randomUUID()
      const preview = await previewPaste(db.d1, rows)
      const first = await approvePaste(db.d1, op, preview.revision, rows)
      assert.equal(first.count, 2)
      assert.deepEqual(await approvePaste(db.d1, op, preview.revision, rows), first)
      assert.equal(count(db, 'transactions'), 2)
      await assert.rejects(approvePaste(db.d1, op, preview.revision, [row(1, { amountMinor: 900 })]), PasteConflict)
      await undoPaste(db.d1, op)
      assert.equal(count(db, 'transactions'), 0)
      assert.equal(count(db, 'transaction_import_keys'), 2)
      assert.equal(count(db, 'transaction_approvals'), 0)
      assert.equal((await approvePaste(db.d1, op, preview.revision, rows)).state, 'undone')
      assert.equal((await undoPaste(db.d1, op)).state, 'undone')
      await assert.rejects(approve(db, rows), PasteConflict)
      await assert.rejects(approve(db, [row(1, { importKey: row(99).importKey })]), PasteConflict)
    } finally { db.raw.close() }
  })
  it('detects duplicates despite category changes, including two rows in one batch', async () => {
    const db = new Database()
    try {
      await approve(db, [row(1)])
      const duplicate = row(2, { payee: row(1).payee, categoryId: 4 })
      assert.equal((await previewPaste(db.d1, [duplicate])).rows[0].duplicate, true)
      await assert.rejects(approve(db, [duplicate]), PasteConflict)
      await approve(db, [{ ...duplicate, duplicateConfirmed: true }])
      const siblings = [row(3), row(4, { payee: row(3).payee })]
      assert((await previewPaste(db.d1, siblings)).rows.every((item) => item.duplicate))
      await assert.rejects(approve(db, siblings), PasteConflict)
    } finally { db.raw.close() }
  })
  it('rejects stale previews and invalid accounts without partial writes', async () => {
    const db = new Database()
    try {
      const preview = await previewPaste(db.d1, [row(1)])
      db.raw.exec("UPDATE accounts SET name = 'Changed account' WHERE id = 1")
      await assert.rejects(approvePaste(db.d1, crypto.randomUUID(), preview.revision, [row(1)]), PasteConflict)
      await assert.rejects(approve(db, [row(1), row(2, { categoryId: 9999 })]), PasteConflict)
      await assert.rejects(approve(db, [row(1, { currency: 'USD' })]), PasteConflict)
      assert.equal(count(db, 'transactions'), 0)
      assert.equal(count(db, 'paste_operations'), 0)
    } finally { db.raw.close() }
  })
  it('rolls back all earlier rows on a late constraint failure', async () => {
    const db = new Database()
    try {
      db.raw.exec("CREATE TRIGGER fail_second BEFORE INSERT ON transactions WHEN NEW.payee = 'Fictional merchant 2' BEGIN SELECT RAISE(ABORT, 'CHECK constraint synthetic failure'); END")
      await assert.rejects(approve(db, [row(1), row(2)]), PasteConflict)
      for (const table of ['transactions', 'transaction_approvals', 'paste_operations', 'transaction_import_keys']) assert.equal(count(db, table), 0)
    } finally { db.raw.close() }
  })
  it('undo refuses changed versions and preserves the entire batch', async () => {
    const db = new Database()
    try {
      const receipt = await approve(db, [row(1), row(2)])
      db.raw.prepare("UPDATE transactions SET updated_at = '2026-10-23T12:00:00.001Z' WHERE id = ?").run(row(2).id)
      await assert.rejects(undoPaste(db.d1, receipt.operationId), PasteConflict)
      assert.equal(count(db, 'transactions'), 2)
      assert.equal(db.raw.prepare('SELECT state FROM paste_operations').get()!.state, 'approved')
    } finally { db.raw.close() }
  })
  it('upgrade backfills reviewed imports only; restoring invalidates undo and approval eligibility', async () => {
    const db = new Database('0021')
    try {
      for (const [index, state] of [[1, 'reviewed'], [2, 'unreviewed'], [3, null]] as const) {
        db.raw.prepare(`INSERT INTO transactions(id,type,amount_minor,currency,account_id,category_id,occurred_on,payee,import_review_status)
          VALUES (?,'expense',1234,'HKD',1,3,'2026-10-20','Fictional history',?)`).run(row(index).id, state)
      }
      db.raw.exec(readFileSync(new URL('../../migrations/0022_paste_approvals.sql', import.meta.url), 'utf8'))
      assert.equal(count(db, 'transaction_approvals'), 1)
      assert.equal((await listPayeeSuggestions(db.d1, 1))[0].useCount, 1)
      const receipt = await approve(db, [row(4)])
      db.raw.exec("UPDATE paste_operations SET state = 'invalidated'; DELETE FROM transactions")
      assert.equal(count(db, 'transaction_approvals'), 0)
      assert.equal((await undoPaste(db.d1, receipt.operationId)).state, 'invalidated')
    } finally { db.raw.close() }
  })
}
