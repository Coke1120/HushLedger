import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

type Row = Record<string, unknown>
type D1Result<T> = { success: true; results: T[]; meta: { changes: number } }

const childRun = process.env.HUSHL_AI_SETTINGS_SERVER_TEST === '1'

if (!childRun) {
  describe('AI settings server-only checks', () => {
    it('runs encrypted persistence contracts under React server conditions', () => {
      const environment: NodeJS.ProcessEnv = {
        ...process.env,
        HUSHL_AI_SETTINGS_SERVER_TEST: '1',
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
  const {
    AiSettingsCryptoError,
    deleteAiProviderSettings,
    getAiProviderSettings,
    getStoredAiProviderSettings,
    saveAiProviderSettings,
  } = await import('./aiSettings')

  function sqliteValue(value: unknown): SQLInputValue {
    return value instanceof ArrayBuffer ? new Uint8Array(value) : value as SQLInputValue
  }

  function d1Row<T extends Row>(row: T | undefined): T | null {
    if (!row) return null
    return Object.fromEntries(Object.entries(row).map(([key, value]) => [
      key,
      value instanceof Uint8Array
        ? value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
        : value,
    ])) as T
  }

  class TestStatement {
    constructor(
      private readonly database: TestDatabase,
      readonly sql: string,
      readonly values: SQLInputValue[] = [],
    ) {}

    bind(...values: unknown[]) {
      return new TestStatement(this.database, this.sql, values.map(sqliteValue))
    }

    async first<T extends Row>(): Promise<T | null> {
      return d1Row(this.database.raw.prepare(this.sql).get(...this.values) as T | undefined)
    }

    async run<T extends Row>(): Promise<D1Result<T>> {
      const statement = this.database.raw.prepare(this.sql)
      if (/\bRETURNING\b/i.test(this.sql)) {
        const results = (statement.all(...this.values) as T[]).map((row) => d1Row(row) as T)
        return { success: true, results, meta: { changes: results.length } }
      }
      const result = statement.run(...this.values)
      return { success: true, results: [], meta: { changes: Number(result.changes) } }
    }
  }

  class TestDatabase {
    readonly raw = new DatabaseSync(':memory:')

    constructor() {
      this.raw.exec(readFileSync(
        new URL('../../migrations/0021_ai_provider_settings.sql', import.meta.url),
        'utf8',
      ))
    }

    prepare(sql: string) {
      return new TestStatement(this, sql)
    }

    close() {
      this.raw.close()
    }
  }

  const encryptionKey = '11'.repeat(32)
  const wrongEncryptionKey = '22'.repeat(32)
  const fictionalApiKey = 'fictional-api-key-that-must-be-encrypted'
  const initialSettings = {
    baseUrl: 'https://fictional-provider.example/v1',
    apiKey: fictionalApiKey,
    model: 'fictional-model-v1',
  }

  async function createSettings(database: TestDatabase) {
    const result = await saveAiProviderSettings(
      database as unknown as D1Database,
      initialSettings,
      null,
      encryptionKey,
    )
    assert.equal(result.kind, 'created')
    if (result.kind !== 'created') throw new Error('test setup failed')
    return result.settings
  }

  function cryptoError(code: string) {
    return (error: unknown) => error instanceof AiSettingsCryptoError && error.code === code
  }

  describe('AI settings encrypted persistence', () => {
    it('stores no fictional plaintext API key in the D1 row', async () => {
      const database = new TestDatabase()
      try {
        await createSettings(database)
        const row = database.raw.prepare(`
          SELECT api_key_ciphertext AS ciphertext, api_key_iv AS iv
          FROM ai_provider_settings WHERE id = 1
        `).get() as { ciphertext: Uint8Array; iv: Uint8Array }

        assert.equal(Buffer.from(row.ciphertext).includes(Buffer.from(fictionalApiKey)), false)
        assert.equal(Buffer.from(row.ciphertext).toString('utf8').includes(fictionalApiKey), false)
        assert.equal(row.iv.byteLength, 12)
      } finally {
        database.close()
      }
    })

    it('decrypts stored settings with the configured key', async () => {
      const database = new TestDatabase()
      try {
        const created = await createSettings(database)
        const result = await getStoredAiProviderSettings(
          database as unknown as D1Database,
          encryptionKey,
          created.updatedAt,
        )

        assert.deepEqual(result, { kind: 'found', settings: initialSettings })
      } finally {
        database.close()
      }
    })

    it('fails closed when the encryption key is missing', async () => {
      const database = new TestDatabase()
      try {
        const created = await createSettings(database)
        await assert.rejects(
          getStoredAiProviderSettings(
            database as unknown as D1Database,
            undefined,
            created.updatedAt,
          ),
          cryptoError('ENCRYPTION_KEY_INVALID'),
        )
      } finally {
        database.close()
      }
    })

    it('fails closed when the encryption key is wrong', async () => {
      const database = new TestDatabase()
      try {
        const created = await createSettings(database)
        await assert.rejects(
          getStoredAiProviderSettings(
            database as unknown as D1Database,
            wrongEncryptionKey,
            created.updatedAt,
          ),
          cryptoError('DECRYPTION_FAILED'),
        )
      } finally {
        database.close()
      }
    })

    it('fails closed when the encrypted key is moved to a different provider URL', async () => {
      const database = new TestDatabase()
      try {
        const created = await createSettings(database)
        database.raw.prepare(`
          UPDATE ai_provider_settings
          SET base_url = 'https://attacker.invalid/v1'
          WHERE id = 1
        `).run()

        await assert.rejects(
          getStoredAiProviderSettings(
            database as unknown as D1Database,
            encryptionKey,
            created.updatedAt,
          ),
          cryptoError('DECRYPTION_FAILED'),
        )
      } finally {
        database.close()
      }
    })

    it('returns only redacted public metadata', async () => {
      const database = new TestDatabase()
      try {
        const created = await createSettings(database)
        const metadata = await getAiProviderSettings(database as unknown as D1Database)

        assert.deepEqual(metadata, created)
        assert.deepEqual(Object.keys(metadata ?? {}).sort(), [
          'baseUrl',
          'createdAt',
          'hasApiKey',
          'model',
          'updatedAt',
        ])
      } finally {
        database.close()
      }
    })

    it('rejects a stale create without replacing the stored row', async () => {
      const database = new TestDatabase()
      try {
        const created = await createSettings(database)
        const result = await saveAiProviderSettings(
          database as unknown as D1Database,
          { ...initialSettings, apiKey: 'fictional-second-key' },
          null,
          encryptionKey,
        )

        assert.equal(result.kind, 'version_conflict')
        assert.deepEqual(await getAiProviderSettings(database as unknown as D1Database), created)
      } finally {
        database.close()
      }
    })

    it('rejects an update with a stale version', async () => {
      const database = new TestDatabase()
      try {
        await createSettings(database)
        const result = await saveAiProviderSettings(
          database as unknown as D1Database,
          { baseUrl: initialSettings.baseUrl, model: 'fictional-model-v2' },
          '2026-01-01T00:00:00.000Z',
          encryptionKey,
        )

        assert.equal(result.kind, 'version_conflict')
      } finally {
        database.close()
      }
    })

    it('retains ciphertext when updating without a replacement key', async () => {
      const database = new TestDatabase()
      try {
        const created = await createSettings(database)
        const before = database.raw.prepare(`
          SELECT api_key_ciphertext AS ciphertext, api_key_iv AS iv
          FROM ai_provider_settings WHERE id = 1
        `).get() as { ciphertext: Uint8Array; iv: Uint8Array }
        const result = await saveAiProviderSettings(
          database as unknown as D1Database,
          { baseUrl: initialSettings.baseUrl, model: 'fictional-model-v2' },
          created.updatedAt,
          encryptionKey,
        )
        const after = database.raw.prepare(`
          SELECT api_key_ciphertext AS ciphertext, api_key_iv AS iv
          FROM ai_provider_settings WHERE id = 1
        `).get() as { ciphertext: Uint8Array; iv: Uint8Array }

        assert.equal(result.kind, 'updated')
        assert.deepEqual(after.ciphertext, before.ciphertext)
        assert.deepEqual(after.iv, before.iv)
      } finally {
        database.close()
      }
    })

    it('requires a replacement key when changing the provider URL', async () => {
      const database = new TestDatabase()
      try {
        const created = await createSettings(database)
        const result = await saveAiProviderSettings(
          database as unknown as D1Database,
          {
            baseUrl: 'https://different-fictional-provider.example/v1',
            model: initialSettings.model,
          },
          created.updatedAt,
          encryptionKey,
        )
        const stored = await getStoredAiProviderSettings(
          database as unknown as D1Database,
          encryptionKey,
          created.updatedAt,
        )

        assert.equal(result.kind, 'api_key_required')
        assert.deepEqual(stored, { kind: 'found', settings: initialSettings })
      } finally {
        database.close()
      }
    })

    it('replaces ciphertext when a new API key is supplied', async () => {
      const database = new TestDatabase()
      try {
        const created = await createSettings(database)
        const before = database.raw.prepare(`
          SELECT api_key_ciphertext AS ciphertext FROM ai_provider_settings WHERE id = 1
        `).get() as { ciphertext: Uint8Array }
        const replacement = 'fictional-replacement-api-key'
        const updated = await saveAiProviderSettings(
          database as unknown as D1Database,
          { ...initialSettings, apiKey: replacement },
          created.updatedAt,
          encryptionKey,
        )
        assert.equal(updated.kind, 'updated')
        if (updated.kind !== 'updated') throw new Error('test setup failed')
        const resolved = await getStoredAiProviderSettings(
          database as unknown as D1Database,
          encryptionKey,
          updated.settings.updatedAt,
        )
        const after = database.raw.prepare(`
          SELECT api_key_ciphertext AS ciphertext FROM ai_provider_settings WHERE id = 1
        `).get() as { ciphertext: Uint8Array }

        assert.notDeepEqual(after.ciphertext, before.ciphertext)
        assert.equal(resolved.kind === 'found' ? resolved.settings.apiKey : null, replacement)
      } finally {
        database.close()
      }
    })

    it('rejects a delete with a stale version', async () => {
      const database = new TestDatabase()
      try {
        await createSettings(database)
        const result = await deleteAiProviderSettings(
          database as unknown as D1Database,
          '2026-01-01T00:00:00.000Z',
        )

        assert.equal(result.kind, 'version_conflict')
      } finally {
        database.close()
      }
    })

    it('deletes settings at the expected version', async () => {
      const database = new TestDatabase()
      try {
        const created = await createSettings(database)
        const result = await deleteAiProviderSettings(
          database as unknown as D1Database,
          created.updatedAt,
        )

        assert.deepEqual(result, { kind: 'deleted' })
        assert.equal(await getAiProviderSettings(database as unknown as D1Database), null)
      } finally {
        database.close()
      }
    })
  })
}
