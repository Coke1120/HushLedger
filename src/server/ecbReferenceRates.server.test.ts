import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

type Row = Record<string, unknown>
type BatchResult<T> = { success: true; results: T[]; meta: { changes: number } }

const childRun = process.env.HUSHL_ECB_REFERENCE_RATES_SERVER_TEST === '1'

if (!childRun) {
  describe('ECB reference-rate server checks', () => {
    it('runs the fetch and snapshot contract under React server conditions', () => {
      const environment: NodeJS.ProcessEnv = {
        ...process.env,
        HUSHL_ECB_REFERENCE_RATES_SERVER_TEST: '1',
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
    EcbReferenceRateUnavailableError,
    fetchEcbReferenceRates,
    listLatestEcbReferenceRates,
    saveEcbReferenceRates,
  } = await import('./ecbReferenceRates')

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
      const statement = this.database.raw.prepare(this.sql)
      const results = statement.all(...this.values) as T[]
      return { success: true, results, meta: { changes: 0 } }
    }

    async run<T extends Row>(): Promise<BatchResult<T>> {
      const statement = this.database.raw.prepare(this.sql)
      statement.run(...this.values)
      return { success: true, results: [], meta: { changes: 0 } }
    }
  }

  class TestDatabase {
    readonly raw = new DatabaseSync(':memory:')

    constructor() {
      this.raw.exec(`
        CREATE TABLE ecb_reference_rates (
          source TEXT NOT NULL,
          base_currency TEXT NOT NULL,
          quote_currency TEXT NOT NULL,
          observed_on TEXT NOT NULL,
          rate TEXT NOT NULL,
          fetched_at TEXT NOT NULL,
          PRIMARY KEY(source, quote_currency, observed_on)
        );
      `)
    }

    prepare(sql: string) { return new TestStatement(this, sql) }

    async batch(statements: TestStatement[]) {
      for (const statement of statements) await statement.run()
      return []
    }

    close() { this.raw.close() }
  }

  const header = 'KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE,OBS_STATUS'
  const body = `${header}\nEXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-07-13,1.1424,A\n`

  describe('ECB reference-rate fetch and persistence', () => {
    it('uses only the fixed ECB CSV endpoint and parses its validated response', async () => {
      let requestedUrl = ''
      let accept = ''
      let redirect: RequestRedirect | undefined
      const rates = await fetchEcbReferenceRates(async (url, init) => {
        requestedUrl = String(url)
        accept = new Headers(init?.headers).get('accept') ?? ''
        redirect = init?.redirect
        return new Response(body, { headers: { 'content-type': 'text/csv' } })
      })
      assert.equal(
        requestedUrl,
        'https://data-api.ecb.europa.eu/service/data/EXR/D..EUR.SP00.A?lastNObservations=1&format=csvdata',
      )
      assert.equal(accept, 'text/csv')
      assert.equal(redirect, 'error')
      assert.deepEqual(rates, [{ quoteCurrency: 'USD', rate: '1.1424', observedOn: '2026-07-13' }])
    })

    it('fails closed for upstream errors, oversized responses, and malformed CSV', async () => {
      await assert.rejects(
        () => fetchEcbReferenceRates(async () => new Response('', { status: 503 })),
        EcbReferenceRateUnavailableError,
      )
      await assert.rejects(
        () => fetchEcbReferenceRates(async () => new Response(body, {
          headers: { 'content-length': String(256 * 1024 + 1) },
        })),
        EcbReferenceRateUnavailableError,
      )
      await assert.rejects(
        () => fetchEcbReferenceRates(async () => new Response('not,csv\n')), EcbReferenceRateUnavailableError,
      )
      const oversized = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(256 * 1024 + 1))
          controller.close()
        },
      })
      await assert.rejects(
        () => fetchEcbReferenceRates(async () => new Response(oversized)),
        EcbReferenceRateUnavailableError,
      )
    })

    it('persists the complete snapshot once and never overwrites an observation', async () => {
      const database = new TestDatabase()
      try {
        await saveEcbReferenceRates(database as unknown as D1Database, [
          { quoteCurrency: 'HKD', rate: '9.1477', observedOn: '2026-07-13' },
          { quoteCurrency: 'USD', rate: '1.1424', observedOn: '2026-07-13' },
        ], '2026-07-13T16:00:00.000Z')
        await saveEcbReferenceRates(database as unknown as D1Database, [
          { quoteCurrency: 'USD', rate: '9.9999', observedOn: '2026-07-13' },
        ], '2026-07-14T16:00:00.000Z')
        assert.deepEqual(await listLatestEcbReferenceRates(database as unknown as D1Database), [
          { quoteCurrency: 'HKD', rate: '9.1477', observedOn: '2026-07-13', fetchedAt: '2026-07-13T16:00:00.000Z' },
          { quoteCurrency: 'USD', rate: '1.1424', observedOn: '2026-07-13', fetchedAt: '2026-07-13T16:00:00.000Z' },
        ])
      } finally {
        database.close()
      }
    })
  })
}
