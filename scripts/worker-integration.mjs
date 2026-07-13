import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer as createHttpServer, request as httpRequest } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const wrangler = join(projectRoot, 'node_modules', '.bin', 'wrangler')
const openNext = join(projectRoot, 'node_modules', '.bin', 'opennextjs-cloudflare')
const next = join(projectRoot, 'node_modules', '.bin', 'next')
const skipBuild = process.argv.includes('--skip-build')
const temporaryRoot = await mkdtemp(join(tmpdir(), 'hushledger-integration-'))
const freshState = join(temporaryRoot, 'fresh-state')
const upgradeState = join(temporaryRoot, 'upgrade-state')
let workerProcess
let nextProcess
let providerServer

function hktCalendarDate() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function shiftCalendarMonth(month, amount) {
  const [year, monthNumber] = month.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, monthNumber - 1 + amount, 1))
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`
}

function shiftCalendarDay(date, amount) {
  const shifted = new Date(`${date}T00:00:00.000Z`)
  shifted.setUTCDate(shifted.getUTCDate() + amount)
  return shifted.toISOString().slice(0, 10)
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function backupChecksum({ format, version, exportedAt, schemaVersion, data }) {
  return createHash('sha256')
    .update(canonicalJson({ format, version, exportedAt, schemaVersion, data }))
    .digest('hex')
}

async function availablePort() {
  const server = createNetServer()
  await new Promise((resolveReady, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveReady)
  })
  const address = server.address()
  assert(address && typeof address === 'object')
  const { port } = address
  await new Promise((resolveClosed, reject) => server.close((error) => (error ? reject(error) : resolveClosed())))
  return port
}

async function startFakeAiProvider(port, { categoryName, occurredOn }) {
  providerServer = createHttpServer((request, response) => {
    const respond = (status, payload) => {
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(payload))
    }

    if (request.headers.authorization !== 'Bearer fictional-api-key-value') {
      respond(401, { error: 'unauthorized' })
      return
    }
    if (request.method === 'GET' && request.url === '/v1/models') {
      respond(200, { data: [{ id: 'fictional-model' }] })
      return
    }
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      respond(404, { error: 'not found' })
      return
    }

    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        assert.equal(body.model, 'fictional-model')
        assert.equal(body.max_completion_tokens, 4_096)
        assert.equal(body.max_tokens, undefined)
        assert.equal(body.response_format?.json_schema?.strict, true)
        respond(200, {
          choices: [{
            message: {
              content: JSON.stringify({
                rows: [{
                  sourceLine: 1,
                  occurredOn,
                  direction: 'expense',
                  amountText: '12.34',
                  currency: 'HKD',
                  description: 'Integration merchant',
                  suggestedCategoryName: categoryName,
                  confidence: 0.99,
                  flags: [],
                }],
              }),
              refusal: null,
            },
          }],
        })
      } catch (error) {
        respond(500, { error: error instanceof Error ? error.message : 'invalid request' })
      }
    })
  })
  await new Promise((resolveReady, reject) => {
    providerServer.once('error', reject)
    providerServer.listen(port, '127.0.0.1', resolveReady)
  })
}

function runWrangler(args) {
  return runCommand(wrangler, args, 'wrangler')
}

function runCommand(command, args, label) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: { ...process.env, CI: '1', NO_COLOR: '1', WRANGLER_SEND_METRICS: 'false' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolveRun({ stdout, stderr })
      else reject(new Error(`${label} ${args.join(' ')} failed (${code})\n${stderr || stdout}`))
    })
  })
}

async function verifyUpgradeMigration() {
  const subsetDirectory = join(temporaryRoot, 'migrations-through-0004')
  await mkdir(subsetDirectory)
  const migrationNames = (await readdir(join(projectRoot, 'migrations')))
    .filter((name) => /^000[1-4]_.*\.sql$/.test(name))
    .sort()
  assert.equal(migrationNames.length, 4)
  await Promise.all(
    migrationNames.map((name) => copyFile(join(projectRoot, 'migrations', name), join(subsetDirectory, name))),
  )

  const upgradeConfig = join(temporaryRoot, 'wrangler-upgrade.json')
  const migrationWorker = join(temporaryRoot, 'migration-worker.js')
  await writeFile(migrationWorker, "export default { fetch() { return new Response('migration-only') } }\n")
  await writeFile(
    upgradeConfig,
    JSON.stringify({
      name: 'hushledger-upgrade-verification',
      main: migrationWorker,
      compatibility_date: '2026-07-11',
      d1_databases: [
        {
          binding: 'DB',
          database_name: 'hushledger',
          database_id: 'REPLACE_WITH_D1_DATABASE_ID',
          migrations_dir: subsetDirectory,
        },
      ],
    }),
  )

  await runWrangler([
    'd1',
    'migrations',
    'apply',
    'hushledger',
    '--local',
    '--persist-to',
    upgradeState,
    '--config',
    upgradeConfig,
  ])

  const sentinelId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  await runWrangler([
    'd1',
    'execute',
    'hushledger',
    '--local',
    '--persist-to',
    upgradeState,
    '--config',
    upgradeConfig,
    '--command',
    `INSERT INTO transactions(id,type,amount_minor,currency,account_id,category_id,occurred_on,payee,note) VALUES ('${sentinelId}','expense',123,'HKD',1,3,'2026-07-10','upgrade sentinel','');
     INSERT INTO accounts(name,type,currency,is_active,sort_order) VALUES ('Integration custom account','bank','HKD',1,900);
     INSERT INTO categories(name,type,icon,color,is_active,sort_order) VALUES ('Integration custom category','expense','circle-ellipsis','#64748B',1,900);`,
    '--yes',
  ])

  await runWrangler([
    'd1',
    'migrations',
    'apply',
    'hushledger',
    '--local',
    '--persist-to',
    upgradeState,
  ])

  const verification = await runWrangler([
    'd1',
    'execute',
    'hushledger',
    '--local',
    '--persist-to',
    upgradeState,
    '--command',
    `SELECT id, occurred_on AS occurredOn, cleared FROM transactions WHERE id = '${sentinelId}';
     SELECT name, localization_key AS localizationKey FROM accounts WHERE name IN ('日常帳戶','Integration custom account') ORDER BY name;
     SELECT name, localization_key AS localizationKey, monthly_plan_minor AS monthlyPlanMinor FROM categories WHERE name IN ('生活','Integration custom category') ORDER BY name;
     SELECT COUNT(*) AS importKeys FROM transaction_import_keys;
     SELECT revision FROM ledger_state WHERE id = 1;
     PRAGMA foreign_key_check;`,
    '--json',
  ])
  const statements = JSON.parse(verification.stdout)
  assert.equal(statements[0].results[0].id, sentinelId)
  assert.equal(statements[0].results[0].occurredOn, '2026-07-10')
  assert.equal(statements[0].results[0].cleared, 1)
  assert.deepEqual(statements[1].results, [
    { name: 'Integration custom account', localizationKey: null },
    { name: '日常帳戶', localizationKey: 'account.bank' },
  ])
  assert.deepEqual(statements[2].results, [
    { name: 'Integration custom category', localizationKey: null, monthlyPlanMinor: null },
    { name: '生活', localizationKey: 'category.living', monthlyPlanMinor: null },
  ])
  assert.equal(statements[3].results[0].importKeys, 0)
  assert.equal(statements[4].results[0].revision, 1)
  assert.deepEqual(statements[5].results, [])
}

async function seedCsvExportRows() {
  const today = hktCalendarDate()
  const previousMonth = shiftCalendarMonth(today.slice(0, 7), -1)
  await runWrangler([
    'd1',
    'execute',
    'hushledger',
    '--local',
    '--persist-to',
    freshState,
    '--command',
    `WITH RECURSIVE sequence(value) AS (
       SELECT 1
       UNION ALL
       SELECT value + 1 FROM sequence WHERE value < 205
     )
     INSERT INTO transactions(id,type,amount_minor,currency,account_id,category_id,occurred_on,payee,note)
     SELECT printf('30000000-0000-4000-8000-%012d', value),'expense',100 + value,'HKD',1,3,'${today}','export bulk',''
     FROM sequence;
     INSERT INTO transactions(id,type,amount_minor,currency,account_id,category_id,occurred_on,payee,note)
     VALUES('30000000-0000-4000-8000-000000999999','expense',12345,'HKD',1,3,'${previousMonth}-15','export bulk','historical trend');
     UPDATE transactions SET note = 'Trip planning #Summer2026' WHERE id = '30000000-0000-4000-8000-000000000001';
     UPDATE transactions SET note = 'Near miss #Summer20260' WHERE id = '30000000-0000-4000-8000-000000000002';
     UPDATE transactions SET note = 'Escaped ##Summer2026' WHERE id = '30000000-0000-4000-8000-000000000003';
     UPDATE categories SET monthly_plan_minor = 50000 WHERE id = 3;`,
    '--yes',
  ])
}

function startWorker(port, inspectorPort) {
  const child = spawn(
    wrangler,
    [
      'dev',
      '--local',
      '--port',
      String(port),
      '--inspector-port',
      String(inspectorPort),
      '--persist-to',
      freshState,
      '--test-scheduled',
      '--log-level',
      'error',
      '--show-interactive-dev-session=false',
    ],
    {
      cwd: projectRoot,
      env: { ...process.env, CI: '1', NO_COLOR: '1', WRANGLER_SEND_METRICS: 'false' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  let output = ''
  child.stdout.on('data', (chunk) => {
    output = `${output}${chunk}`.slice(-20_000)
  })
  child.stderr.on('data', (chunk) => {
    output = `${output}${chunk}`.slice(-20_000)
  })
  child.output = () => output
  return child
}

function startNextDev(port) {
  const child = spawn(
    next,
    ['dev', '--hostname', '127.0.0.1', '--port', String(port)],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        CI: '1',
        HUSHLEDGER_DEV_PERSIST_PATH: join(freshState, 'v3'),
        NEXT_TELEMETRY_DISABLED: '1',
        NO_COLOR: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  let output = ''
  child.stdout.on('data', (chunk) => {
    output = `${output}${chunk}`.slice(-20_000)
  })
  child.stderr.on('data', (chunk) => {
    output = `${output}${chunk}`.slice(-20_000)
  })
  child.output = () => output
  return child
}

async function waitForHealth(baseUrl) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (workerProcess.exitCode !== null) throw new Error(`Worker exited before readiness\n${workerProcess.output()}`)
    try {
      const response = await fetch(`${baseUrl}/api/health`)
      if (response.ok) return
    } catch {
      // Wrangler is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150))
  }
  throw new Error(`Worker did not become ready\n${workerProcess.output()}`)
}

async function waitForNextHealth(baseUrl) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (nextProcess.exitCode !== null) throw new Error(`Next dev exited before readiness\n${nextProcess.output()}`)
    try {
      const response = await fetch(`${baseUrl}/api/health`)
      if (response.ok) return
    } catch {
      // Next.js is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150))
  }
  throw new Error(`Next dev did not become ready\n${nextProcess.output()}`)
}

async function api(baseUrl, path, { method = 'GET', body, origin = baseUrl } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json', origin },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const contentType = response.headers.get('content-type') ?? ''
  const bytes = contentType.includes('application/json')
    ? undefined
    : new Uint8Array(await response.clone().arrayBuffer())
  const payload = contentType.includes('application/json') ? await response.json() : await response.text()
  return { response, payload, bytes }
}

function rawHttpGet(baseUrl, headers) {
  const url = new URL(baseUrl)
  return new Promise((resolveResponse, reject) => {
    const request = httpRequest(
      {
        headers,
        hostname: url.hostname,
        method: 'GET',
        path: url.pathname,
        port: url.port,
      },
      (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () =>
          resolveResponse({
            body: Buffer.concat(chunks).toString('utf8'),
            headers: response.headers,
            status: response.statusCode,
          }),
        )
      },
    )
    request.once('error', reject)
    request.end()
  })
}

async function verifyNextShell(baseUrl) {
  const spoofedAccess = await rawHttpGet(baseUrl, {
    host: 'ledger.example.com',
    'x-hushledger-access-verified': 'true',
  })
  assert.equal(spoofedAccess.status, 503)
  assert.deepEqual(JSON.parse(spoofedAccess.body), {
    ok: false,
    error: { code: 'ACCESS_CONFIG_MISSING', message: 'Cloudflare Access is not configured.' },
  })
  assert.match(spoofedAccess.headers['cache-control'] ?? '', /private.*no-store/)

  const root = await fetch(baseUrl)
  assert.equal(root.status, 200)
  assert.match(root.headers.get('cache-control') ?? '', /private.*no-store/)
  assert.equal(root.headers.get('x-frame-options'), 'DENY')
  assert.match(root.headers.get('x-robots-tag') ?? '', /noindex/)
  const policy = root.headers.get('content-security-policy') ?? ''
  assert.match(policy, /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/)
  assert.doesNotMatch(policy, /unsafe-inline/)

  const nonce = policy.match(/'nonce-([^']+)'/)?.[1]
  assert(nonce)
  const html = await root.text()
  assert.match(html, /HushLedger/)
  assert(html.includes(`nonce="${nonce}"`), 'Next bootstrap scripts must carry the request CSP nonce')

  const manifest = await fetch(`${baseUrl}/manifest.webmanifest`)
  assert.equal(manifest.status, 200)
  const manifestPayload = await manifest.json()
  assert.match(manifestPayload.name, /^HushLedger/)
  assert.equal(manifestPayload.display, 'standalone')
  assert(manifestPayload.icons.some(({ src }) => src === '/pwa-512.png'))

  const serviceWorker = await fetch(`${baseUrl}/sw.js`)
  assert.equal(serviceWorker.status, 200)
  assert.match(serviceWorker.headers.get('cache-control') ?? '', /no-cache.*no-store/)
  assert.match(serviceWorker.headers.get('service-worker-allowed') ?? '', /^\/$/)
  const serviceWorkerSource = await serviceWorker.text()
  assert.match(serviceWorkerSource, /__HUSHLEDGER_RELEASE_ID__/)
  assert.match(serviceWorkerSource, /importScripts\('\/sw-runtime\.js'\)/)

  const serviceWorkerRuntime = await fetch(`${baseUrl}/sw-runtime.js`)
  assert.equal(serviceWorkerRuntime.status, 200)
  const serviceWorkerRuntimeSource = await serviceWorkerRuntime.text()
  assert.match(serviceWorkerRuntimeSource, /\/offline/)
  assert.match(serviceWorkerRuntimeSource, /_next\/static/)
  assert.match(serviceWorkerRuntimeSource, /caches\.delete/)

  const offline = await fetch(`${baseUrl}/offline`)
  assert.equal(offline.status, 200)
  assert.match(await offline.text(), /HushLedger/)

  const unknownApi = await api(baseUrl, '/api/not-a-real-route')
  assert.equal(unknownApi.response.status, 404)
  assert.equal(unknownApi.payload.ok, false)
  assert.equal(unknownApi.payload.error.code, 'NOT_FOUND')
}

async function verifyWorkerApi() {
  const port = await availablePort()
  const inspectorPort = await availablePort()
  const baseUrl = `http://127.0.0.1:${port}`
  workerProcess = startWorker(port, inspectorPort)
  await waitForHealth(baseUrl)
  await verifyNextShell(baseUrl)

  const today = hktCalendarDate()
  const month = today.slice(0, 7)
  const previousMonth = shiftCalendarMonth(month, -1)
  const accountsResult = await api(baseUrl, '/api/accounts')
  const categoriesResult = await api(baseUrl, '/api/categories')
  assert.equal(accountsResult.response.status, 200)
  assert.equal(categoriesResult.response.status, 200)
  assert.match(accountsResult.response.headers.get('cache-control') ?? '', /no-store/)
  assert(accountsResult.payload.data.every(({ updatedAt }) => typeof updatedAt === 'string' && updatedAt.endsWith('Z')))
  assert(categoriesResult.payload.data.every(({ updatedAt }) => typeof updatedAt === 'string' && updatedAt.endsWith('Z')))

  const payeeSuggestions = await api(baseUrl, '/api/payee-suggestions')
  assert.equal(payeeSuggestions.response.status, 200)
  assert.match(payeeSuggestions.response.headers.get('cache-control') ?? '', /no-store/)
  assert.deepEqual(payeeSuggestions.payload.data, [{
    payee: 'export bulk',
    type: 'expense',
    accountId: 1,
    categoryId: 3,
    lastUsedOn: today,
    useCount: 206,
  }])

  const categorySummary = await api(baseUrl, `/api/summary?month=${month}`)
  assert.equal(categorySummary.response.status, 200)
  assert.equal(categorySummary.payload.data.income, 0)
  assert.equal(categorySummary.payload.data.expense, 41_615)
  assert.equal(categorySummary.payload.data.balance, -41_615)
  assert.deepEqual(categorySummary.payload.data.expenseByCategory, [{
    categoryId: 3,
    categoryName: '餐飲',
    categoryLocalizationKey: 'category.food',
    categoryIcon: 'utensils',
    categoryColor: '#C16B4B',
    amountMinor: 41_615,
    transactionCount: 205,
  }])
  assert.deepEqual(categorySummary.payload.data.monthlySpendingPlans, [{
    categoryId: 3,
    categoryName: '餐飲',
    categoryLocalizationKey: 'category.food',
    categoryIcon: 'utensils',
    categoryColor: '#C16B4B',
    plannedMinor: 50_000,
    spentMinor: 41_615,
  }])
  assert.equal(categorySummary.payload.data.spendingTrend.length, 6)
  assert.deepEqual(categorySummary.payload.data.spendingTrend.slice(-2), [
    { month: previousMonth, amountMinor: 12_345, transactionCount: 1 },
    { month, amountMinor: 41_615, transactionCount: 205 },
  ])
  assert.deepEqual(categorySummary.payload.data.recurringForecast, [])

  const duplicateMonth = await api(baseUrl, `/api/transactions?month=${month}&month=${month}`)
  assert.equal(duplicateMonth.response.status, 400)
  assert.equal(duplicateMonth.payload.error.code, 'INVALID_QUERY')

  const invalidAccountFilter = await api(baseUrl, `/api/transactions?month=${month}&accountId=0`)
  assert.equal(invalidAccountFilter.response.status, 400)
  assert.equal(invalidAccountFilter.payload.error.code, 'INVALID_QUERY')

  const invalidTagFilter = await api(baseUrl, `/api/transactions?month=${month}&tag=Summer2026%2C`)
  assert.equal(invalidTagFilter.response.status, 400)
  assert.equal(invalidTagFilter.payload.error.code, 'INVALID_QUERY')

  const exactTagFilter = await api(
    baseUrl,
    `/api/transactions?month=${month}&tag=Summer2026`,
  )
  assert.equal(exactTagFilter.response.status, 200, JSON.stringify(exactTagFilter.payload))
  assert.deepEqual(exactTagFilter.payload.data.map(({ id }) => id), [
    '30000000-0000-4000-8000-000000000001',
  ])

  const caseSensitiveTagFilter = await api(
    baseUrl,
    `/api/transactions?month=${month}&tag=summer2026`,
  )
  assert.equal(caseSensitiveTagFilter.response.status, 200)
  assert.deepEqual(caseSensitiveTagFilter.payload.data, [])

  const duplicateAccountFilter = await api(
    baseUrl,
    `/api/transactions?month=${month}&accountId=1&accountId=1`,
  )
  assert.equal(duplicateAccountFilter.response.status, 400)
  assert.equal(duplicateAccountFilter.payload.error.code, 'INVALID_QUERY')

  const wrongMediaType = await fetch(`${baseUrl}/api/transactions`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain', origin: baseUrl },
    body: '{}',
  })
  assert.equal(wrongMediaType.status, 415)
  assert.equal((await wrongMediaType.json()).error.code, 'UNSUPPORTED_MEDIA_TYPE')

  const invalidJson = await fetch(`${baseUrl}/api/transactions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: baseUrl },
    body: '{',
  })
  assert.equal(invalidJson.status, 400)
  assert.equal((await invalidJson.json()).error.code, 'INVALID_JSON')

  const oversized = await fetch(`${baseUrl}/api/transactions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify({ padding: 'x'.repeat(17 * 1024) }),
  })
  assert.equal(oversized.status, 413)
  assert.equal((await oversized.json()).error.code, 'PAYLOAD_TOO_LARGE')

  const beforeAiDrafts = await api(baseUrl, `/api/transactions?month=${month}`)
  const crossOriginAi = await api(baseUrl, '/api/ai/models', {
    method: 'POST',
    origin: 'https://attacker.invalid',
    body: { provider: { baseUrl: 'https://provider.example/v1', apiKey: 'fictional' } },
  })
  assert.equal(crossOriginAi.response.status, 403)
  assert.equal(crossOriginAi.payload.error.code, 'ORIGIN_FORBIDDEN')

  const invalidAiConfig = await api(baseUrl, '/api/ai/models', {
    method: 'POST',
    body: { provider: { baseUrl: 'https://provider.example/v1', apiKey: '' } },
  })
  assert.equal(invalidAiConfig.response.status, 400)
  assert.equal(invalidAiConfig.payload.error.code, 'AI_PROVIDER_CONFIG_INVALID')

  const oversizedStatement = await api(baseUrl, '/api/imports/parse', {
    method: 'POST',
    body: {
      provider: {
        baseUrl: 'https://provider.example/v1',
        apiKey: 'fictional',
        model: 'fictional-model',
      },
      accountId: 1,
      currency: 'HKD',
      dateOrder: 'DMY',
      statementText: '銀'.repeat(22_000),
    },
  })
  assert.equal(oversizedStatement.response.status, 413)
  assert.equal(oversizedStatement.payload.error.code, 'AI_STATEMENT_TOO_LARGE')
  const afterAiDrafts = await api(baseUrl, `/api/transactions?month=${month}`)
  assert.equal(afterAiDrafts.payload.data.length, beforeAiDrafts.payload.data.length)

  assert.deepEqual(
    Object.fromEntries(accountsResult.payload.data.map(({ name, localizationKey }) => [name, localizationKey])),
    {
      '日常帳戶': 'account.bank',
      '現金': 'account.cash',
      '信用卡': 'account.credit_card',
      '八達通': 'account.wallet',
    },
  )
  assert.deepEqual(
    Object.fromEntries(categoriesResult.payload.data.map(({ name, localizationKey }) => [name, localizationKey])),
    {
      '薪資': 'category.salary',
      '其他收入': 'category.other_income',
      '餐飲': 'category.food',
      '交通': 'category.transport',
      '生活': 'category.living',
      '娛樂': 'category.entertainment',
      '購物': 'category.shopping',
      '住屋': 'category.housing',
      '帳單': 'category.bills',
      '醫療': 'category.healthcare',
      '其他支出': 'category.other_expense',
    },
  )

  const crossOriginReference = await api(baseUrl, '/api/accounts', {
    method: 'POST',
    body: { name: 'Hostile account', type: 'bank' },
    origin: 'https://attacker.invalid',
  })
  assert.equal(crossOriginReference.response.status, 403)
  assert.equal(crossOriginReference.payload.error.code, 'ORIGIN_FORBIDDEN')

  const createdAccount = await api(baseUrl, '/api/accounts', {
    method: 'POST',
    body: { name: 'Integration savings', type: 'bank' },
  })
  assert.equal(createdAccount.response.status, 201)
  assert.equal(createdAccount.payload.data.localizationKey, null)
  assert.equal(createdAccount.payload.data.isActive, true)

  const duplicateAccount = await api(baseUrl, '/api/accounts', {
    method: 'POST',
    body: { name: 'integration SAVINGS', type: 'cash' },
  })
  assert.equal(duplicateAccount.response.status, 409)
  assert.equal(duplicateAccount.payload.error.code, 'REFERENCE_NAME_CONFLICT')

  const renamedAccount = await api(baseUrl, `/api/accounts/${createdAccount.payload.data.id}`, {
    method: 'PUT',
    body: {
      name: 'Integration wallet',
      type: 'wallet',
      updatedAt: createdAccount.payload.data.updatedAt,
    },
  })
  assert.equal(renamedAccount.response.status, 200)
  assert.equal(renamedAccount.payload.data.name, 'Integration wallet')
  assert.equal(renamedAccount.payload.data.type, 'wallet')
  assert.notEqual(renamedAccount.payload.data.updatedAt, createdAccount.payload.data.updatedAt)

  const staleAccount = await api(baseUrl, `/api/accounts/${createdAccount.payload.data.id}`, {
    method: 'PUT',
    body: {
      name: 'Stale account edit',
      type: 'cash',
      updatedAt: createdAccount.payload.data.updatedAt,
    },
  })
  assert.equal(staleAccount.response.status, 409)
  assert.equal(staleAccount.payload.error.code, 'REFERENCE_VERSION_CONFLICT')

  const disabledAccount = await api(baseUrl, `/api/accounts/${createdAccount.payload.data.id}`, {
    method: 'PATCH',
    body: { isActive: false, updatedAt: renamedAccount.payload.data.updatedAt },
  })
  assert.equal(disabledAccount.response.status, 200)
  assert.equal(disabledAccount.payload.data.isActive, false)
  const enabledAccount = await api(baseUrl, `/api/accounts/${createdAccount.payload.data.id}`, {
    method: 'PATCH',
    body: { isActive: true, updatedAt: disabledAccount.payload.data.updatedAt },
  })
  assert.equal(enabledAccount.response.status, 200)
  assert.equal(enabledAccount.payload.data.isActive, true)

  const temporarilyDisabledAccounts = []
  for (const builtInAccount of accountsResult.payload.data) {
    const disabled = await api(baseUrl, `/api/accounts/${builtInAccount.id}`, {
      method: 'PATCH',
      body: { isActive: false, updatedAt: builtInAccount.updatedAt },
    })
    assert.equal(disabled.response.status, 200)
    temporarilyDisabledAccounts.push(disabled.payload.data)
  }
  const lastAccountDisable = await api(baseUrl, `/api/accounts/${enabledAccount.payload.data.id}`, {
    method: 'PATCH',
    body: { isActive: false, updatedAt: enabledAccount.payload.data.updatedAt },
  })
  assert.equal(lastAccountDisable.response.status, 409)
  assert.equal(lastAccountDisable.payload.error.code, 'REFERENCE_LAST_ACTIVE')
  for (const disabledAccountItem of temporarilyDisabledAccounts) {
    const reenabled = await api(baseUrl, `/api/accounts/${disabledAccountItem.id}`, {
      method: 'PATCH',
      body: { isActive: true, updatedAt: disabledAccountItem.updatedAt },
    })
    assert.equal(reenabled.response.status, 200)
  }

  const createdCategory = await api(baseUrl, '/api/categories', {
    method: 'POST',
    body: { name: 'Integration flexible', type: 'expense', monthlyPlanMinor: 25_000 },
  })
  assert.equal(createdCategory.response.status, 201)
  assert.equal(createdCategory.payload.data.icon, 'circle-ellipsis')
  assert.equal(createdCategory.payload.data.localizationKey, null)
  assert.equal(createdCategory.payload.data.monthlyPlanMinor, 25_000)

  const duplicateCategory = await api(baseUrl, '/api/categories', {
    method: 'POST',
    body: { name: 'integration FLEXIBLE', type: 'expense' },
  })
  assert.equal(duplicateCategory.response.status, 409)
  assert.equal(duplicateCategory.payload.error.code, 'REFERENCE_NAME_CONFLICT')

  const sameNameDifferentType = await api(baseUrl, '/api/categories', {
    method: 'POST',
    body: { name: 'Integration flexible', type: 'income' },
  })
  assert.equal(sameNameDifferentType.response.status, 201)
  assert.equal(sameNameDifferentType.payload.data.type, 'income')
  assert.equal(sameNameDifferentType.payload.data.monthlyPlanMinor, null)

  const invalidIncomePlan = await api(baseUrl, '/api/categories', {
    method: 'POST',
    body: { name: 'Impossible income plan', type: 'income', monthlyPlanMinor: 10_000 },
  })
  assert.equal(invalidIncomePlan.response.status, 400)
  assert.equal(invalidIncomePlan.payload.error.code, 'VALIDATION_ERROR')

  const temporarilyDisabledIncomeCategories = []
  for (const builtInCategory of categoriesResult.payload.data.filter(({ type }) => type === 'income')) {
    const disabled = await api(baseUrl, `/api/categories/${builtInCategory.id}`, {
      method: 'PATCH',
      body: { isActive: false, updatedAt: builtInCategory.updatedAt },
    })
    assert.equal(disabled.response.status, 200)
    temporarilyDisabledIncomeCategories.push(disabled.payload.data)
  }
  const lastIncomeCategoryDisable = await api(
    baseUrl,
    `/api/categories/${sameNameDifferentType.payload.data.id}`,
    {
      method: 'PATCH',
      body: { isActive: false, updatedAt: sameNameDifferentType.payload.data.updatedAt },
    },
  )
  assert.equal(lastIncomeCategoryDisable.response.status, 409)
  assert.equal(lastIncomeCategoryDisable.payload.error.code, 'REFERENCE_LAST_ACTIVE')
  for (const disabledCategoryItem of temporarilyDisabledIncomeCategories) {
    const reenabled = await api(baseUrl, `/api/categories/${disabledCategoryItem.id}`, {
      method: 'PATCH',
      body: { isActive: true, updatedAt: disabledCategoryItem.updatedAt },
    })
    assert.equal(reenabled.response.status, 200)
  }

  const renamedCategory = await api(baseUrl, `/api/categories/${createdCategory.payload.data.id}`, {
    method: 'PUT',
    body: {
      name: 'Integration essentials',
      type: 'expense',
      monthlyPlanMinor: 30_000,
      updatedAt: createdCategory.payload.data.updatedAt,
    },
  })
  assert.equal(renamedCategory.response.status, 200)
  assert.equal(renamedCategory.payload.data.name, 'Integration essentials')
  assert.equal(renamedCategory.payload.data.monthlyPlanMinor, 30_000)
  assert.notEqual(renamedCategory.payload.data.updatedAt, createdCategory.payload.data.updatedAt)

  const staleCategory = await api(baseUrl, `/api/categories/${createdCategory.payload.data.id}`, {
    method: 'PUT',
    body: {
      name: 'Stale category edit',
      type: 'expense',
      monthlyPlanMinor: null,
      updatedAt: createdCategory.payload.data.updatedAt,
    },
  })
  assert.equal(staleCategory.response.status, 409)
  assert.equal(staleCategory.payload.error.code, 'REFERENCE_VERSION_CONFLICT')

  const disabledCategory = await api(baseUrl, `/api/categories/${createdCategory.payload.data.id}`, {
    method: 'PATCH',
    body: { isActive: false, updatedAt: renamedCategory.payload.data.updatedAt },
  })
  assert.equal(disabledCategory.response.status, 200)
  assert.equal(disabledCategory.payload.data.isActive, false)
  const enabledCategory = await api(baseUrl, `/api/categories/${createdCategory.payload.data.id}`, {
    method: 'PATCH',
    body: { isActive: true, updatedAt: disabledCategory.payload.data.updatedAt },
  })
  assert.equal(enabledCategory.response.status, 200)
  assert.equal(enabledCategory.payload.data.isActive, true)

  const referenceDelete = await api(baseUrl, `/api/accounts/${createdAccount.payload.data.id}`, {
    method: 'DELETE',
    body: {},
  })
  assert.equal(referenceDelete.response.status, 404)
  assert.equal(referenceDelete.payload.error.code, 'NOT_FOUND')

  const freshAccounts = await api(baseUrl, '/api/accounts')
  const activeAccounts = freshAccounts.payload.data.filter(({ isActive }) => isActive)
  const desiredAccountOrder = [...activeAccounts].reverse()
  const crossOriginAccountOrder = await api(baseUrl, '/api/accounts', {
    method: 'PATCH',
    origin: 'https://attacker.invalid',
    body: {
      items: desiredAccountOrder.map(({ id, updatedAt }) => ({ id, updatedAt })),
    },
  })
  assert.equal(crossOriginAccountOrder.response.status, 403)
  assert.equal(crossOriginAccountOrder.payload.error.code, 'ORIGIN_FORBIDDEN')

  const reorderedAccounts = await api(baseUrl, '/api/accounts', {
    method: 'PATCH',
    body: {
      items: desiredAccountOrder.map(({ id, updatedAt }) => ({ id, updatedAt })),
    },
  })
  assert.equal(reorderedAccounts.response.status, 200, JSON.stringify(reorderedAccounts.payload))
  assert.deepEqual(
    reorderedAccounts.payload.data.map(({ id }) => id),
    desiredAccountOrder.map(({ id }) => id),
  )

  const staleAccountOrder = await api(baseUrl, '/api/accounts', {
    method: 'PATCH',
    body: {
      items: activeAccounts.map(({ id, updatedAt }) => ({ id, updatedAt })),
    },
  })
  assert.equal(staleAccountOrder.response.status, 409)
  assert.equal(staleAccountOrder.payload.error.code, 'REFERENCE_VERSION_CONFLICT')
  const accountsAfterStaleOrder = await api(baseUrl, '/api/accounts')
  assert.deepEqual(
    accountsAfterStaleOrder.payload.data.filter(({ isActive }) => isActive).map(({ id }) => id),
    desiredAccountOrder.map(({ id }) => id),
  )

  const freshCategories = await api(baseUrl, '/api/categories')
  const activeExpenseCategories = freshCategories.payload.data
    .filter(({ isActive, type }) => isActive && type === 'expense')
  const desiredCategoryOrder = [...activeExpenseCategories].reverse()
  const reorderedCategories = await api(baseUrl, '/api/categories', {
    method: 'PATCH',
    body: {
      items: desiredCategoryOrder.map(({ id, updatedAt }) => ({ id, updatedAt })),
    },
  })
  assert.equal(reorderedCategories.response.status, 200, JSON.stringify(reorderedCategories.payload))
  assert.deepEqual(
    reorderedCategories.payload.data.map(({ id }) => id),
    desiredCategoryOrder.map(({ id }) => id),
  )

  const categoriesAfterOrder = await api(baseUrl, '/api/categories')
  const orderedExpenseIds = categoriesAfterOrder.payload.data
    .filter(({ isActive, type }) => isActive && type === 'expense')
    .map(({ id }) => id)
  assert.deepEqual(orderedExpenseIds, desiredCategoryOrder.map(({ id }) => id))
  assert.deepEqual(
    categoriesAfterOrder.payload.data
      .filter(({ isActive, type }) => isActive && type === 'income')
      .map(({ id }) => id),
    freshCategories.payload.data
      .filter(({ isActive, type }) => isActive && type === 'income')
      .map(({ id }) => id),
  )

  const partialCategoryOrder = await api(baseUrl, '/api/categories', {
    method: 'PATCH',
    body: {
      items: categoriesAfterOrder.payload.data
        .filter(({ isActive, type }) => isActive && type === 'expense')
        .slice(1)
        .map(({ id, updatedAt }) => ({ id, updatedAt })),
    },
  })
  assert.equal(partialCategoryOrder.response.status, 409)
  assert.equal(partialCategoryOrder.payload.error.code, 'REFERENCE_VERSION_CONFLICT')
  const categoriesAfterPartialOrder = await api(baseUrl, '/api/categories')
  assert.deepEqual(
    categoriesAfterPartialOrder.payload.data
      .filter(({ isActive, type }) => isActive && type === 'expense')
      .map(({ id }) => id),
    desiredCategoryOrder.map(({ id }) => id),
  )

  let account = reorderedAccounts.payload.data
    .find(({ id }) => id === enabledAccount.payload.data.id)
  let expenseCategory = reorderedCategories.payload.data
    .find(({ id }) => id === enabledCategory.payload.data.id)
  assert(account)
  assert(expenseCategory)

  const cappedExportRows = await api(baseUrl, `/api/transactions?month=${month}&search=export%20bulk`)
  assert.equal(cappedExportRows.response.status, 200)
  assert.equal(cappedExportRows.payload.data.length, 200)

  const completeFilterSummary = await api(
    baseUrl,
    `/api/transactions/summary?month=${month}&search=export%20bulk`,
  )
  assert.equal(completeFilterSummary.response.status, 200)
  assert.deepEqual(completeFilterSummary.payload.data, {
    transactionCount: 205,
    income: 0,
    expense: 41_615,
    net: -41_615,
  })

  const duplicateSummaryMonth = await api(
    baseUrl,
    `/api/transactions/summary?month=${month}&month=${month}`,
  )
  assert.equal(duplicateSummaryMonth.response.status, 400)
  assert.equal(duplicateSummaryMonth.payload.error.code, 'INVALID_QUERY')

  const stackedFilterRows = await api(
    baseUrl,
    `/api/transactions?month=${month}&type=expense&accountId=1&categoryId=3&search=export%20bulk`,
  )
  assert.equal(stackedFilterRows.response.status, 200)
  assert.equal(stackedFilterRows.payload.data.length, 200)
  assert(stackedFilterRows.payload.data.every(({ accountId, categoryId }) => (
    accountId === 1 && categoryId === 3
  )))

  const stackedFilterSummary = await api(
    baseUrl,
    `/api/transactions/summary?month=${month}&type=expense&accountId=1&categoryId=3&search=export%20bulk`,
  )
  assert.equal(stackedFilterSummary.response.status, 200)
  assert.deepEqual(stackedFilterSummary.payload.data, completeFilterSummary.payload.data)

  const mismatchedAccountRows = await api(
    baseUrl,
    `/api/transactions?month=${month}&accountId=2&search=export%20bulk`,
  )
  assert.equal(mismatchedAccountRows.response.status, 200)
  assert.deepEqual(mismatchedAccountRows.payload.data, [])

  const emptyFilterSummary = await api(
    baseUrl,
    `/api/transactions/summary?month=${month}&accountId=2&search=export%20bulk`,
  )
  assert.equal(emptyFilterSummary.response.status, 200)
  assert.deepEqual(emptyFilterSummary.payload.data, {
    transactionCount: 0,
    income: 0,
    expense: 0,
    net: 0,
  })

  const uncappedCsvExport = await api(baseUrl, `/api/exports/transactions?month=${month}&search=export%20bulk`)
  assert.equal(uncappedCsvExport.response.status, 200)
  assert.match(uncappedCsvExport.response.headers.get('content-type') ?? '', /^text\/csv;\s*charset=utf-8/i)
  assert.match(uncappedCsvExport.response.headers.get('cache-control') ?? '', /private.*no-store/)
  assert.equal(
    uncappedCsvExport.response.headers.get('content-disposition'),
    `attachment; filename="hushledger-transactions-${month}.csv"`,
  )
  assert.deepEqual([...uncappedCsvExport.bytes.slice(0, 3)], [0xef, 0xbb, 0xbf])
  assert(uncappedCsvExport.payload.startsWith('Date,Type,Amount,Currency'))
  assert.match(uncappedCsvExport.payload.split('\r\n', 1)[0], /Transaction ID$/)
  const uncappedCsvRows = uncappedCsvExport.payload.trimEnd().split('\r\n').length - 1
  assert.equal(uncappedCsvRows, 205)

  const largestFirst = await api(
    baseUrl,
    `/api/transactions?month=${month}&search=export%20bulk&sort=amount_desc`,
  )
  assert.equal(largestFirst.response.status, 200)
  assert.equal(largestFirst.payload.data.length, 200)
  assert.equal(largestFirst.payload.data[0].amountMinor, 305)
  assert.equal(largestFirst.payload.data.at(-1).amountMinor, 106)
  const smallestFirst = await api(
    baseUrl,
    `/api/transactions?month=${month}&search=export%20bulk&sort=amount_asc`,
  )
  assert.equal(smallestFirst.response.status, 200)
  assert.equal(smallestFirst.payload.data[0].amountMinor, 101)
  assert.equal(smallestFirst.payload.data.at(-1).amountMinor, 300)
  const rejectedSort = await api(
    baseUrl,
    `/api/transactions?month=${month}&sort=amount_desc%3BDELETE`,
  )
  assert.equal(rejectedSort.response.status, 400)
  assert.equal(rejectedSort.payload.error.code, 'INVALID_QUERY')

  const sortedCsvExport = await api(
    baseUrl,
    `/api/exports/transactions?month=${month}&search=export%20bulk&sort=amount_desc`,
  )
  assert.equal(sortedCsvExport.response.status, 200)
  assert.equal(sortedCsvExport.payload.split('\r\n')[1].split(',')[2], '-3.05')

  const taggedCsvExport = await api(
    baseUrl,
    `/api/exports/transactions?month=${month}&tag=Summer2026`,
  )
  assert.equal(taggedCsvExport.response.status, 200)
  assert.equal(taggedCsvExport.payload.trimEnd().split('\r\n').length - 1, 1)
  assert.match(taggedCsvExport.payload, /Trip planning #Summer2026/)

  const referenceFilteredCsvExport = await api(
    baseUrl,
    `/api/exports/transactions?month=${month}&accountId=1&categoryId=3&search=export%20bulk`,
  )
  assert.equal(referenceFilteredCsvExport.response.status, 200)
  assert.equal(referenceFilteredCsvExport.payload.trimEnd().split('\r\n').length - 1, 205)

  const transaction = {
    id: '10000000-0000-4000-8000-000000000001',
    type: 'expense',
    amountMinor: 123,
    currency: 'HKD',
    accountId: account.id,
    categoryId: expenseCategory.id,
    occurredOn: `${today}T12:00:00.000Z`,
    payee: 'integration test',
    note: '',
  }
  const timeBearing = await api(baseUrl, '/api/transactions', { method: 'POST', body: transaction })
  assert.equal(timeBearing.response.status, 400)
  assert.equal(timeBearing.payload.error.code, 'VALIDATION_ERROR')

  const crossOrigin = await api(baseUrl, '/api/transactions', {
    method: 'POST',
    body: { ...transaction, id: '10000000-0000-4000-8000-000000000002', occurredOn: today },
    origin: 'https://attacker.invalid',
  })
  assert.equal(crossOrigin.response.status, 403)
  assert.equal(crossOrigin.payload.error.code, 'ORIGIN_FORBIDDEN')

  const transactionBody = {
    ...transaction,
    id: '10000000-0000-4000-8000-000000000003',
    occurredOn: today,
    cleared: false,
  }
  const createdTransaction = await api(baseUrl, '/api/transactions', {
    method: 'POST',
    body: transactionBody,
  })
  assert.equal(createdTransaction.response.status, 201)
  assert.equal(createdTransaction.payload.data.amountMinor, 123)
  assert.equal(createdTransaction.payload.data.cleared, false)

  const duplicateCandidate = {
    type: transactionBody.type,
    amountMinor: transactionBody.amountMinor,
    currency: transactionBody.currency,
    accountId: transactionBody.accountId,
    categoryId: transactionBody.categoryId,
    occurredOn: transactionBody.occurredOn,
    payee: transactionBody.payee,
    note: transactionBody.note,
  }
  const crossOriginDuplicateCheck = await api(baseUrl, '/api/transactions/duplicates', {
    method: 'POST',
    body: duplicateCandidate,
    origin: 'https://attacker.invalid',
  })
  assert.equal(crossOriginDuplicateCheck.response.status, 403)
  assert.equal(crossOriginDuplicateCheck.payload.error.code, 'ORIGIN_FORBIDDEN')

  const exactDuplicateCheck = await api(baseUrl, '/api/transactions/duplicates', {
    method: 'POST',
    body: duplicateCandidate,
  })
  assert.equal(exactDuplicateCheck.response.status, 200)
  assert.deepEqual(exactDuplicateCheck.payload.data, { matchCount: 1 })

  const editDuplicateCheck = await api(baseUrl, '/api/transactions/duplicates', {
    method: 'POST',
    body: { ...duplicateCandidate, excludeId: transactionBody.id },
  })
  assert.equal(editDuplicateCheck.response.status, 200)
  assert.deepEqual(editDuplicateCheck.payload.data, { matchCount: 0 })

  const changedDuplicateCheck = await api(baseUrl, '/api/transactions/duplicates', {
    method: 'POST',
    body: { ...duplicateCandidate, note: `${duplicateCandidate.note} changed` },
  })
  assert.equal(changedDuplicateCheck.response.status, 200)
  assert.deepEqual(changedDuplicateCheck.payload.data, { matchCount: 0 })

  const invalidDuplicateCheck = await api(baseUrl, '/api/transactions/duplicates', {
    method: 'POST',
    body: { ...duplicateCandidate, cleared: false },
  })
  assert.equal(invalidDuplicateCheck.response.status, 400)
  assert.equal(invalidDuplicateCheck.payload.error.code, 'VALIDATION_ERROR')

  const unclearedTransactions = await api(baseUrl, `/api/transactions?month=${month}&status=uncleared`)
  assert.equal(unclearedTransactions.response.status, 200)
  assert.deepEqual(unclearedTransactions.payload.data.map(({ id }) => id), [transactionBody.id])

  const csvImportIds = {
    fresh: '41000000-0000-4000-8000-000000000001',
    possibleDuplicate: '41000000-0000-4000-8000-000000000002',
    invalidAccount: '41000000-0000-4000-8000-000000000003',
  }
  const csvImportRows = [
    {
      ...transactionBody,
      id: csvImportIds.fresh,
      amountMinor: 777,
      payee: 'CSV import fresh',
      cleared: true,
      sourceRow: 2,
      importKey: `csv:hushledger:id:${csvImportIds.fresh}`,
      include: true,
    },
    {
      ...transactionBody,
      amountMinor: 999,
      sourceRow: 3,
      importKey: `csv:hushledger:id:${transactionBody.id}`,
      include: false,
    },
    {
      ...transactionBody,
      id: csvImportIds.possibleDuplicate,
      sourceRow: 4,
      importKey: `csv:bank:id:${'b'.repeat(64)}`,
      include: false,
    },
    {
      ...transactionBody,
      id: csvImportIds.invalidAccount,
      accountId: 999_999,
      sourceRow: 5,
      importKey: `csv:hushledger:id:${csvImportIds.invalidAccount}`,
      include: false,
    },
  ]
  const crossOriginCsvImport = await api(baseUrl, '/api/imports/csv', {
    method: 'POST',
    body: { mode: 'preview', rows: csvImportRows },
    origin: 'https://attacker.invalid',
  })
  assert.equal(crossOriginCsvImport.response.status, 403)
  assert.equal(crossOriginCsvImport.payload.error.code, 'ORIGIN_FORBIDDEN')

  const csvPreview = await api(baseUrl, '/api/imports/csv', {
    method: 'POST',
    body: { mode: 'preview', rows: csvImportRows },
  })
  assert.equal(csvPreview.response.status, 200, JSON.stringify(csvPreview.payload))
  assert.deepEqual(csvPreview.payload.data.rows.map(({ status }) => status), [
    'new',
    'id_conflict',
    'possible_duplicate',
    'account_invalid',
  ])
  assert.deepEqual(
    {
      ready: csvPreview.payload.data.ready,
      possibleDuplicates: csvPreview.payload.data.possibleDuplicates,
      skipped: csvPreview.payload.data.skipped,
      blocked: csvPreview.payload.data.blocked,
    },
    { ready: 1, possibleDuplicates: 1, skipped: 0, blocked: 2 },
  )

  const csvCommit = await api(baseUrl, '/api/imports/csv', {
    method: 'POST',
    body: { mode: 'commit', rows: csvImportRows },
  })
  assert.equal(csvCommit.response.status, 201, JSON.stringify(csvCommit.payload))
  assert.equal(csvCommit.payload.data.imported, 1)
  assert.equal(csvCommit.payload.data.staleSkipped, 0)

  const csvRepreview = await api(baseUrl, '/api/imports/csv', {
    method: 'POST',
    body: { mode: 'preview', rows: csvImportRows.map((row) => ({ ...row, include: false })) },
  })
  assert.equal(csvRepreview.payload.data.rows[0].status, 'already_imported')

  const importedCsvTransaction = await api(baseUrl, `/api/transactions/${csvImportIds.fresh}`)
  assert.equal(importedCsvTransaction.response.status, 200)
  const deletedCsvTransaction = await api(baseUrl, `/api/transactions/${csvImportIds.fresh}`, {
    method: 'DELETE',
    body: { updatedAt: importedCsvTransaction.payload.data.updatedAt },
  })
  assert.equal(deletedCsvTransaction.response.status, 200)
  const csvAfterDelete = await api(baseUrl, '/api/imports/csv', {
    method: 'POST',
    body: { mode: 'preview', rows: [csvImportRows[0]] },
  })
  assert.equal(csvAfterDelete.payload.data.rows[0].status, 'already_imported')

  const duplicateOverrideRows = csvImportRows.map((row, index) => ({
    ...row,
    include: index === 2,
  }))
  const csvDuplicateCommit = await api(baseUrl, '/api/imports/csv', {
    method: 'POST',
    body: { mode: 'commit', rows: duplicateOverrideRows },
  })
  assert.equal(csvDuplicateCommit.response.status, 201, JSON.stringify(csvDuplicateCommit.payload))
  assert.equal(csvDuplicateCommit.payload.data.imported, 1)
  const importedPossibleDuplicate = await api(
    baseUrl,
    `/api/transactions/${csvImportIds.possibleDuplicate}`,
  )
  assert.equal(importedPossibleDuplicate.response.status, 200)

  const collisionKey = `csv:hushledger:row:${'a'.repeat(64)}`
  const collisionIds = [
    '41000000-0000-4000-8000-000000000004',
    '41000000-0000-4000-8000-000000000005',
  ]
  const collisionRows = collisionIds.map((id, index) => ({
    ...transactionBody,
    id,
    amountMinor: 1_200 + index,
    payee: `CSV atomic collision ${index + 1}`,
    sourceRow: 6 + index,
    importKey: collisionKey,
    include: true,
  }))
  const csvCollisionCommit = await api(baseUrl, '/api/imports/csv', {
    method: 'POST',
    body: { mode: 'commit', rows: collisionRows },
  })
  assert.equal(csvCollisionCommit.response.status, 409, JSON.stringify(csvCollisionCommit.payload))
  assert.equal(csvCollisionCommit.payload.error.code, 'CSV_IMPORT_STALE')
  for (const id of collisionIds) {
    const rolledBackTransaction = await api(baseUrl, `/api/transactions/${id}`)
    assert.equal(rolledBackTransaction.response.status, 404)
  }

  const fetchedTransaction = await api(baseUrl, `/api/transactions/${transactionBody.id}`)
  assert.equal(fetchedTransaction.response.status, 200)
  assert.equal(fetchedTransaction.payload.data.id, transactionBody.id)

  const { id: immutableId, ...transactionFields } = transactionBody
  assert.equal(immutableId, transactionBody.id)
  const staleTransactionUpdate = await api(baseUrl, `/api/transactions/${transactionBody.id}`, {
    method: 'PUT',
    body: { ...transactionFields, updatedAt: '2026-01-01T00:00:00.000Z' },
  })
  assert.equal(staleTransactionUpdate.response.status, 409)
  assert.equal(staleTransactionUpdate.payload.error.code, 'TRANSACTION_VERSION_CONFLICT')

  const updatedTransaction = await api(baseUrl, `/api/transactions/${transactionBody.id}`, {
    method: 'PUT',
    body: {
      ...transactionFields,
      amountMinor: 456,
      payee: 'edited integration test',
      updatedAt: createdTransaction.payload.data.updatedAt,
    },
  })
  assert.equal(updatedTransaction.response.status, 200)
  assert.equal(updatedTransaction.payload.data.amountMinor, 456)
  assert.equal(updatedTransaction.payload.data.payee, 'edited integration test')

  const pausedRuleId = '20000000-0000-4000-8000-000000000008'
  const pausedRule = await api(baseUrl, '/api/recurring-rules', {
    method: 'POST',
    body: {
      id: pausedRuleId,
      name: 'Archived reference check',
      type: 'expense',
      amountMinor: 100,
      currency: 'HKD',
      accountId: account.id,
      categoryId: expenseCategory.id,
      frequency: 'monthly',
      scheduleStartsOn: today,
      isActive: false,
      payee: '',
      note: '',
    },
  })
  assert.equal(pausedRule.response.status, 201)
  assert.equal(pausedRule.payload.data.isActive, false)

  const archivedAccount = await api(baseUrl, `/api/accounts/${account.id}`, {
    method: 'PATCH',
    body: { isActive: false, updatedAt: account.updatedAt },
  })
  assert.equal(archivedAccount.response.status, 200)
  const archivedCategory = await api(baseUrl, `/api/categories/${expenseCategory.id}`, {
    method: 'PATCH',
    body: { isActive: false, updatedAt: expenseCategory.updatedAt },
  })
  assert.equal(archivedCategory.response.status, 200)

  const updatedArchivedTransaction = await api(baseUrl, `/api/transactions/${transactionBody.id}`, {
    method: 'PUT',
    body: {
      ...transactionFields,
      amountMinor: 456,
      payee: 'edited integration test',
      note: 'archived references remain editable',
      updatedAt: updatedTransaction.payload.data.updatedAt,
    },
  })
  assert.equal(updatedArchivedTransaction.response.status, 200)
  assert.equal(updatedArchivedTransaction.payload.data.note, 'archived references remain editable')

  const rejectedInactiveReference = await api(baseUrl, '/api/transactions', {
    method: 'POST',
    body: {
      ...transactionBody,
      id: '10000000-0000-4000-8000-000000000004',
    },
  })
  assert.equal(rejectedInactiveReference.response.status, 400)
  assert.equal(rejectedInactiveReference.payload.error.code, 'ACCOUNT_INVALID')

  const rejectedAccountResume = await api(baseUrl, `/api/recurring-rules/${pausedRuleId}/status`, {
    method: 'PATCH',
    body: { isActive: true, revision: pausedRule.payload.data.revision },
  })
  assert.equal(rejectedAccountResume.response.status, 400)
  assert.equal(rejectedAccountResume.payload.error.code, 'ACCOUNT_INVALID')

  const reenabledAccount = await api(baseUrl, `/api/accounts/${account.id}`, {
    method: 'PATCH',
    body: { isActive: true, updatedAt: archivedAccount.payload.data.updatedAt },
  })
  assert.equal(reenabledAccount.response.status, 200)
  const rejectedCategoryResume = await api(baseUrl, `/api/recurring-rules/${pausedRuleId}/status`, {
    method: 'PATCH',
    body: { isActive: true, revision: pausedRule.payload.data.revision },
  })
  assert.equal(rejectedCategoryResume.response.status, 400)
  assert.equal(rejectedCategoryResume.payload.error.code, 'CATEGORY_INVALID')
  const reenabledCategory = await api(baseUrl, `/api/categories/${expenseCategory.id}`, {
    method: 'PATCH',
    body: { isActive: true, updatedAt: archivedCategory.payload.data.updatedAt },
  })
  assert.equal(reenabledCategory.response.status, 200)
  account = reenabledAccount.payload.data
  expenseCategory = reenabledCategory.payload.data

  const removedPausedRule = await api(baseUrl, `/api/recurring-rules/${pausedRuleId}`, {
    method: 'DELETE',
    body: { revision: pausedRule.payload.data.revision },
  })
  assert.equal(removedPausedRule.response.status, 200)

  const filteredCsvExport = await api(
    baseUrl,
    `/api/exports/transactions?month=${month}&type=expense&search=edited%20integration%20test`,
  )
  assert.equal(filteredCsvExport.response.status, 200)
  assert.match(filteredCsvExport.payload, /2026-\d{2}-\d{2},expense,-4\.56,HKD/)
  assert.match(filteredCsvExport.payload, /"edited integration test"/)
  assert.match(filteredCsvExport.payload, /,Uncleared,/)

  const staleTransactionDelete = await api(baseUrl, `/api/transactions/${transactionBody.id}`, {
    method: 'DELETE',
    body: { updatedAt: createdTransaction.payload.data.updatedAt },
  })
  assert.equal(staleTransactionDelete.response.status, 409)
  assert.equal(staleTransactionDelete.payload.error.code, 'TRANSACTION_VERSION_CONFLICT')

  const deletedTransaction = await api(baseUrl, `/api/transactions/${transactionBody.id}`, {
    method: 'DELETE',
    body: { updatedAt: updatedArchivedTransaction.payload.data.updatedAt },
  })
  assert.equal(deletedTransaction.response.status, 200)
  assert.equal(deletedTransaction.payload.data.deleted, true)

  const missingTransaction = await api(baseUrl, `/api/transactions/${transactionBody.id}`)
  assert.equal(missingTransaction.response.status, 404)
  assert.equal(missingTransaction.payload.error.code, 'TRANSACTION_NOT_FOUND')

  const ruleIds = {
    daily: '20000000-0000-4000-8000-000000000001',
    weekly: '20000000-0000-4000-8000-000000000002',
    monthly: '20000000-0000-4000-8000-000000000003',
    cron: '20000000-0000-4000-8000-000000000004',
    race: '20000000-0000-4000-8000-000000000007',
    skip: '20000000-0000-4000-8000-000000000009',
  }
  const baseRule = {
    name: 'Integration rule',
    type: 'expense',
    amountMinor: 456,
    currency: 'HKD',
    accountId: account.id,
    categoryId: expenseCategory.id,
    scheduleStartsOn: today,
    isActive: true,
    payee: 'integration test',
    note: '',
  }

  const createdRules = []
  for (const frequency of ['daily', 'weekly', 'monthly']) {
    const created = await api(baseUrl, '/api/recurring-rules', {
      method: 'POST',
      body: {
        ...baseRule,
        id: ruleIds[frequency],
        name: `${frequency} integration`,
        frequency,
        scheduleStartsOn: frequency === 'daily' ? '1970-01-01' : today,
      },
    })
    assert.equal(created.response.status, 201)
    assert.equal(created.payload.data.nextOccurrenceOn, today)
    createdRules.push(created.payload.data)
  }

  const skipCandidate = await api(baseUrl, '/api/recurring-rules', {
    method: 'POST',
    body: {
      ...baseRule,
      id: ruleIds.skip,
      name: 'skip integration',
      amountMinor: 457,
      frequency: 'daily',
      scheduleStartsOn: '1970-01-01',
    },
  })
  assert.equal(skipCandidate.response.status, 201)
  assert.equal(skipCandidate.payload.data.nextOccurrenceOn, today)
  const skipped = await api(baseUrl, `/api/recurring-rules/${ruleIds.skip}/skip`, {
    method: 'POST',
    body: { revision: 1, nextOccurrenceOn: today },
  })
  assert.equal(skipped.response.status, 200)
  assert.equal(skipped.payload.data.nextOccurrenceOn, shiftCalendarDay(today, 1))
  assert.equal(skipped.payload.data.lastOccurrenceOn, null)
  assert.equal(skipped.payload.data.generatedCount, 0)
  assert.equal(skipped.payload.data.revision, 2)
  const staleSkip = await api(baseUrl, `/api/recurring-rules/${ruleIds.skip}/skip`, {
    method: 'POST',
    body: { revision: 1, nextOccurrenceOn: today },
  })
  assert.equal(staleSkip.response.status, 409)
  assert.equal(staleSkip.payload.error.code, 'RULE_VERSION_CONFLICT')

  const guardedAccountDisable = await api(baseUrl, `/api/accounts/${account.id}`, {
    method: 'PATCH',
    body: { isActive: false, updatedAt: account.updatedAt },
  })
  assert.equal(guardedAccountDisable.response.status, 409)
  assert.equal(guardedAccountDisable.payload.error.code, 'REFERENCE_ACTIVE_RULES')

  const guardedCategoryDisable = await api(baseUrl, `/api/categories/${expenseCategory.id}`, {
    method: 'PATCH',
    body: { isActive: false, updatedAt: expenseCategory.updatedAt },
  })
  assert.equal(guardedCategoryDisable.response.status, 409)
  assert.equal(guardedCategoryDisable.payload.error.code, 'REFERENCE_ACTIVE_RULES')

  const invalidAccount = await api(baseUrl, '/api/recurring-rules', {
    method: 'POST',
    body: { ...baseRule, id: '20000000-0000-4000-8000-000000000005', frequency: 'daily', accountId: 999999 },
  })
  assert.equal(invalidAccount.response.status, 400)
  assert.equal(invalidAccount.payload.error.code, 'ACCOUNT_INVALID')

  const typeMismatch = await api(baseUrl, '/api/recurring-rules', {
    method: 'POST',
    body: { ...baseRule, id: '20000000-0000-4000-8000-000000000006', frequency: 'daily', type: 'income' },
  })
  assert.equal(typeMismatch.response.status, 400)
  assert.equal(typeMismatch.payload.error.code, 'CATEGORY_TYPE_MISMATCH')

  const staleUpdate = await api(baseUrl, `/api/recurring-rules/${ruleIds.daily}`, {
    method: 'PUT',
    body: { ...baseRule, frequency: 'daily', scheduleStartsOn: '1970-01-01', revision: 2 },
  })
  assert.equal(staleUpdate.response.status, 409)
  assert.equal(staleUpdate.payload.error.code, 'RULE_VERSION_CONFLICT')

  const edited = await api(baseUrl, `/api/recurring-rules/${ruleIds.daily}`, {
    method: 'PUT',
    body: {
      ...baseRule,
      name: 'edited daily integration',
      amountMinor: 789,
      frequency: 'daily',
      scheduleStartsOn: '1970-01-01',
      revision: 1,
    },
  })
  assert.equal(edited.response.status, 200)
  assert.equal(edited.payload.data.name, 'edited daily integration')
  assert.equal(edited.payload.data.amountMinor, 789)
  assert.equal(edited.payload.data.revision, 2)

  const paused = await api(baseUrl, `/api/recurring-rules/${ruleIds.weekly}/status`, {
    method: 'PATCH',
    body: { isActive: false, revision: 1 },
  })
  assert.equal(paused.response.status, 200)
  assert.equal(paused.payload.data.isActive, false)
  const resumed = await api(baseUrl, `/api/recurring-rules/${ruleIds.weekly}/status`, {
    method: 'PATCH',
    body: { isActive: true, revision: paused.payload.data.revision },
  })
  assert.equal(resumed.response.status, 200)
  assert.equal(resumed.payload.data.isActive, true)

  const firstRun = await api(baseUrl, '/api/recurring-rules/run-due', {
    method: 'POST',
    body: { asOf: today },
  })
  assert.equal(firstRun.response.status, 200)
  assert.equal(firstRun.payload.data.created, 3)
  assert.equal(firstRun.payload.data.failed, 0)
  const secondRun = await api(baseUrl, '/api/recurring-rules/run-due', {
    method: 'POST',
    body: { asOf: today },
  })
  assert.equal(secondRun.response.status, 200)
  assert.equal(secondRun.payload.data.created, 0)

  const beforeDelete = await api(baseUrl, `/api/transactions?month=${month}`)
  assert.equal(beforeDelete.response.status, 200)
  assert.equal(beforeDelete.payload.data.filter((item) => item.recurrenceDueOn === today).length, 3)
  assert.equal(beforeDelete.payload.data.some((item) => item.recurringRuleId === ruleIds.skip), false)
  assert(
    beforeDelete.payload.data
      .filter((item) => item.recurrenceDueOn === today)
      .every(
        (item) =>
          item.cleared === false &&
          item.accountLocalizationKey === account.localizationKey &&
          item.categoryLocalizationKey === expenseCategory.localizationKey,
      ),
  )

  const deleted = await api(baseUrl, `/api/recurring-rules/${ruleIds.daily}`, {
    method: 'DELETE',
    body: { revision: edited.payload.data.revision },
  })
  assert.equal(deleted.response.status, 200)
  const repeatedDelete = await api(baseUrl, `/api/recurring-rules/${ruleIds.daily}`, {
    method: 'DELETE',
    body: { revision: edited.payload.data.revision },
  })
  assert.equal(repeatedDelete.response.status, 200)
  const missingRule = await api(baseUrl, `/api/recurring-rules/${ruleIds.daily}`)
  assert.equal(missingRule.response.status, 404)
  const afterDelete = await api(baseUrl, `/api/transactions?month=${month}`)
  assert(afterDelete.payload.data.some((item) => item.recurringRuleId === ruleIds.daily))

  const raceRule = await api(baseUrl, '/api/recurring-rules', {
    method: 'POST',
    body: { ...baseRule, id: ruleIds.race, name: 'race integration', frequency: 'daily' },
  })
  assert.equal(raceRule.response.status, 201)
  const concurrentRuns = await Promise.all([
    api(baseUrl, '/api/recurring-rules/run-due', { method: 'POST', body: { asOf: today } }),
    api(baseUrl, '/api/recurring-rules/run-due', { method: 'POST', body: { asOf: today } }),
  ])
  assert(concurrentRuns.every(({ response }) => response.status === 200))
  assert.equal(
    concurrentRuns.reduce((total, { payload }) => total + payload.data.created, 0),
    1,
  )
  const afterRace = await api(baseUrl, `/api/transactions?month=${month}`)
  assert.equal(afterRace.payload.data.filter((item) => item.recurringRuleId === ruleIds.race).length, 1)

  const cronRule = await api(baseUrl, '/api/recurring-rules', {
    method: 'POST',
    body: { ...baseRule, id: ruleIds.cron, name: 'cron integration', frequency: 'daily' },
  })
  assert.equal(cronRule.response.status, 201)
  const scheduled = await fetch(`${baseUrl}/__scheduled?cron=5+16+*+*+*`)
  assert.equal(scheduled.status, 200)
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
  const afterCron = await api(baseUrl, `/api/transactions?month=${month}`)
  assert.equal(afterCron.payload.data.filter((item) => item.recurringRuleId === ruleIds.cron).length, 1)
  const repeatedScheduled = await fetch(`${baseUrl}/__scheduled?cron=5+16+*+*+*`)
  assert.equal(repeatedScheduled.status, 200)
  const afterRepeatedCron = await api(baseUrl, `/api/transactions?month=${month}`)
  assert.equal(afterRepeatedCron.payload.data.filter((item) => item.recurringRuleId === ruleIds.cron).length, 1)

  const backupDownload = await api(baseUrl, '/api/backups/ledger')
  assert.equal(backupDownload.response.status, 200)
  assert.match(backupDownload.response.headers.get('cache-control') ?? '', /no-store/)
  assert.match(backupDownload.response.headers.get('content-disposition') ?? '', /hushledger-ledger-.*\.json/)
  const backup = backupDownload.payload
  assert.equal(backup.format, 'hushledger-ledger-backup')
  assert.equal(backup.version, 1)
  assert.equal(backup.schemaVersion, 10)
  assert.match(backup.checksum.digest, /^[0-9a-f]{64}$/)
  assert(backup.data.transactions.length > 200)
  assert(backup.data.transactions.every(({ cleared }) => typeof cleared === 'boolean'))
  assert(backup.data.categories.every(({ monthlyPlanMinor }) => (
    monthlyPlanMinor === null || Number.isSafeInteger(monthlyPlanMinor)
  )))
  assert(backup.data.transactionImportKeys.length > 0)

  const crossOriginRestorePreview = await api(baseUrl, '/api/backups/ledger', {
    method: 'POST',
    origin: 'https://attacker.invalid',
    body: { mode: 'preview', backup },
  })
  assert.equal(crossOriginRestorePreview.response.status, 403)
  assert.equal(crossOriginRestorePreview.payload.error.code, 'ORIGIN_FORBIDDEN')

  const tamperedBackup = structuredClone(backup)
  tamperedBackup.data.transactions[0].amountMinor += 1
  const tamperedPreview = await api(baseUrl, '/api/backups/ledger', {
    method: 'POST',
    body: { mode: 'preview', backup: tamperedBackup },
  })
  assert.equal(tamperedPreview.response.status, 400)
  assert.equal(tamperedPreview.payload.error.code, 'BACKUP_CHECKSUM_MISMATCH')

  const originalPreview = await api(baseUrl, '/api/backups/ledger', {
    method: 'POST',
    body: { mode: 'preview', backup },
  })
  assert.equal(originalPreview.response.status, 200, JSON.stringify(originalPreview.payload))
  assert.equal(originalPreview.payload.data.backupCounts.transactions, backup.data.transactions.length)
  assert.equal(originalPreview.payload.data.currentDigest, originalPreview.payload.data.backupDigest)

  const restoreSentinelId = '50000000-0000-4000-8000-000000000001'
  const restoreSentinel = await api(baseUrl, '/api/transactions', {
    method: 'POST',
    body: {
      id: restoreSentinelId,
      type: 'expense',
      amountMinor: 321,
      currency: 'HKD',
      accountId: account.id,
      categoryId: expenseCategory.id,
      occurredOn: today,
      payee: 'restore stale sentinel',
      note: '',
    },
  })
  assert.equal(restoreSentinel.response.status, 201)

  const staleRestore = await api(baseUrl, '/api/backups/ledger', {
    method: 'POST',
    body: {
      mode: 'commit',
      backup,
      expectedCurrentDigest: originalPreview.payload.data.currentDigest,
      expectedRevision: originalPreview.payload.data.currentRevision,
      confirmation: 'RESTORE',
    },
  })
  assert.equal(staleRestore.response.status, 409)
  assert.equal(staleRestore.payload.error.code, 'BACKUP_PREVIEW_STALE')
  assert.equal((await api(baseUrl, `/api/transactions/${restoreSentinelId}`)).response.status, 200)

  const replacementPreview = await api(baseUrl, '/api/backups/ledger', {
    method: 'POST',
    body: { mode: 'preview', backup },
  })
  assert.equal(replacementPreview.response.status, 200)
  assert(replacementPreview.payload.data.currentRevision > originalPreview.payload.data.currentRevision)
  assert.equal(
    replacementPreview.payload.data.currentCounts.transactions,
    replacementPreview.payload.data.backupCounts.transactions + 1,
  )

  const restored = await api(baseUrl, '/api/backups/ledger', {
    method: 'POST',
    body: {
      mode: 'commit',
      backup,
      expectedCurrentDigest: replacementPreview.payload.data.currentDigest,
      expectedRevision: replacementPreview.payload.data.currentRevision,
      confirmation: 'RESTORE',
    },
  })
  assert.equal(restored.response.status, 200, JSON.stringify(restored.payload))
  assert.deepEqual(restored.payload.data.counts, replacementPreview.payload.data.backupCounts)
  assert.equal((await api(baseUrl, `/api/transactions/${restoreSentinelId}`)).response.status, 404)
  const restoredBackup = await api(baseUrl, '/api/backups/ledger')
  assert.deepEqual(restoredBackup.payload.data, backup.data)

  const schema9Backup = structuredClone(backup)
  schema9Backup.schemaVersion = 9
  schema9Backup.data.categories = schema9Backup.data.categories.map(({
    monthlyPlanMinor,
    ...category
  }) => {
    assert(monthlyPlanMinor === null || Number.isSafeInteger(monthlyPlanMinor))
    return category
  })
  schema9Backup.checksum.digest = backupChecksum(schema9Backup)
  const schema9Preview = await api(baseUrl, '/api/backups/ledger', {
    method: 'POST',
    body: { mode: 'preview', backup: schema9Backup },
  })
  assert.equal(schema9Preview.response.status, 200, JSON.stringify(schema9Preview.payload))
  const schema9Restore = await api(baseUrl, '/api/backups/ledger', {
    method: 'POST',
    body: {
      mode: 'commit',
      backup: schema9Backup,
      expectedCurrentDigest: schema9Preview.payload.data.currentDigest,
      expectedRevision: schema9Preview.payload.data.currentRevision,
      confirmation: 'RESTORE',
    },
  })
  assert.equal(schema9Restore.response.status, 200, JSON.stringify(schema9Restore.payload))
  const upgradedSchema9Backup = await api(baseUrl, '/api/backups/ledger')
  assert(upgradedSchema9Backup.payload.data.categories.every(
    ({ monthlyPlanMinor }) => monthlyPlanMinor === null,
  ))
  assert(upgradedSchema9Backup.payload.data.transactions.some(({ cleared }) => cleared === false))

  const schema8Backup = structuredClone(backup)
  schema8Backup.schemaVersion = 8
  schema8Backup.data.categories = schema8Backup.data.categories.map(({
    monthlyPlanMinor,
    ...category
  }) => {
    assert(monthlyPlanMinor === null || Number.isSafeInteger(monthlyPlanMinor))
    return category
  })
  schema8Backup.data.transactions = schema8Backup.data.transactions.map(({ cleared, ...transaction }) => {
    assert.equal(typeof cleared, 'boolean')
    return transaction
  })
  schema8Backup.checksum.digest = backupChecksum(schema8Backup)
  const schema8Preview = await api(baseUrl, '/api/backups/ledger', {
    method: 'POST',
    body: { mode: 'preview', backup: schema8Backup },
  })
  assert.equal(schema8Preview.response.status, 200, JSON.stringify(schema8Preview.payload))
  assert.notEqual(schema8Preview.payload.data.backupDigest, schema8Preview.payload.data.currentDigest)
  const schema8Restore = await api(baseUrl, '/api/backups/ledger', {
    method: 'POST',
    body: {
      mode: 'commit',
      backup: schema8Backup,
      expectedCurrentDigest: schema8Preview.payload.data.currentDigest,
      expectedRevision: schema8Preview.payload.data.currentRevision,
      confirmation: 'RESTORE',
    },
  })
  assert.equal(schema8Restore.response.status, 200, JSON.stringify(schema8Restore.payload))
  const upgradedSchema8Backup = await api(baseUrl, '/api/backups/ledger')
  assert(upgradedSchema8Backup.payload.data.categories.every(
    ({ monthlyPlanMinor }) => monthlyPlanMinor === null,
  ))
  assert(upgradedSchema8Backup.payload.data.transactions.every(({ cleared }) => cleared === true))

  return {
    createdRules: createdRules.length,
    firstRunCreated: firstRun.payload.data.created,
    cronCreated: 1,
    uncappedCsvRows,
    transactionFilterGuards: 4,
    transactionFilterQueries: 4,
    transactionFilterSummaries: 3,
    transactionDuplicateChecks: 5,
    transactionSortQueries: 4,
    transactionTagQueries: 4,
    categorySummaries: 1,
    spendingTrendQueries: 1,
    recurringForecasts: 1,
    recurringSkips: 1,
    payeeSuggestions: 1,
    referenceLifecycles: 2,
    referenceSafetyGuards: 4,
    referenceConflictChecks: 4,
    referenceOrderWrites: 2,
    referenceOrderGuards: 3,
    csvImportPreviewStatuses: 4,
    csvImportWrites: 2,
    csvImportTombstones: 1,
    csvAtomicRollbacks: 1,
    ledgerBackupTables: 5,
    ledgerSchema9Restores: 1,
    ledgerSchema8Restores: 1,
    ledgerRestoreStaleGuards: 1,
    ledgerRestoreTransactions: 1,
  }
}

async function verifyNextAiDrafts() {
  const nextPort = await availablePort()
  const providerPort = await availablePort()
  const baseUrl = `http://127.0.0.1:${nextPort}`
  nextProcess = startNextDev(nextPort)
  await waitForNextHealth(baseUrl)

  const today = hktCalendarDate()
  const month = today.slice(0, 7)
  const [accounts, categories, beforeTransactions] = await Promise.all([
    api(baseUrl, '/api/accounts'),
    api(baseUrl, '/api/categories'),
    api(baseUrl, `/api/transactions?month=${month}`),
  ])
  assert.equal(accounts.response.status, 200, JSON.stringify(accounts.payload))
  assert.equal(categories.response.status, 200, JSON.stringify(categories.payload))
  assert.equal(beforeTransactions.response.status, 200, JSON.stringify(beforeTransactions.payload))
  const account = accounts.payload.data.find((item) => item.isActive && item.currency === 'HKD')
  const category = categories.payload.data.find((item) => item.isActive && item.type === 'expense')
  assert(account)
  assert(category)

  await startFakeAiProvider(providerPort, { categoryName: category.name, occurredOn: today })
  const provider = {
    baseUrl: `http://127.0.0.1:${providerPort}/v1`,
    apiKey: 'fictional-api-key-value',
  }
  const models = await api(baseUrl, '/api/ai/models', {
    method: 'POST',
    body: { provider },
  })
  assert.equal(models.response.status, 200, JSON.stringify(models.payload))
  assert.deepEqual(models.payload.data, ['fictional-model'])

  const parsed = await api(baseUrl, '/api/imports/parse', {
    method: 'POST',
    body: {
      provider: { ...provider, model: 'fictional-model' },
      accountId: account.id,
      currency: 'HKD',
      dateOrder: 'YMD',
      statementText: `${today} Integration merchant 12.34 DR`,
    },
  })
  assert.equal(parsed.response.status, 200, JSON.stringify(parsed.payload))
  assert.equal(parsed.payload.data.drafts.length, 1)
  assert.equal(parsed.payload.data.drafts[0].amountMinor, 1_234)
  assert.equal(parsed.payload.data.drafts[0].categoryId, category.id)
  assert.equal(parsed.payload.data.drafts[0].payee, 'Integration merchant')
  assert.match(parsed.payload.data.drafts[0].importKey, /^ai:statement:row:[0-9a-f]{64}$/)

  const afterTransactions = await api(baseUrl, `/api/transactions?month=${month}`)
  assert.equal(afterTransactions.response.status, 200)
  assert.deepEqual(
    afterTransactions.payload.data.map(({ id }) => id),
    beforeTransactions.payload.data.map(({ id }) => id),
  )

  const draft = parsed.payload.data.drafts[0]
  const aiImportRows = [{
    id: draft.id,
    importKey: draft.importKey,
    sourceRow: draft.sourceLine,
    include: true,
    type: draft.type,
    amountMinor: draft.amountMinor,
    currency: draft.currency,
    accountId: draft.accountId,
    categoryId: draft.categoryId,
    occurredOn: draft.occurredOn,
    cleared: true,
    payee: draft.payee,
    note: '',
  }]
  const crossOriginPreview = await api(baseUrl, '/api/imports/ai', {
    method: 'POST',
    origin: 'https://attacker.invalid',
    body: { mode: 'preview', rows: aiImportRows },
  })
  assert.equal(crossOriginPreview.response.status, 403)
  assert.equal(crossOriginPreview.payload.error.code, 'ORIGIN_FORBIDDEN')

  const preview = await api(baseUrl, '/api/imports/ai', {
    method: 'POST',
    body: { mode: 'preview', rows: aiImportRows },
  })
  assert.equal(preview.response.status, 200, JSON.stringify(preview.payload))
  assert.equal(preview.payload.data.rows[0].status, 'new')

  const committed = await api(baseUrl, '/api/imports/ai', {
    method: 'POST',
    body: { mode: 'commit', rows: aiImportRows },
  })
  assert.equal(committed.response.status, 201, JSON.stringify(committed.payload))
  assert.equal(committed.payload.data.imported, 1)

  const importedTransaction = await api(baseUrl, `/api/transactions/${draft.id}`)
  assert.equal(importedTransaction.response.status, 200)
  assert.equal(importedTransaction.payload.data.payee, 'Integration merchant')
  assert.equal(importedTransaction.payload.data.cleared, true)

  const repeatedParse = await api(baseUrl, '/api/imports/parse', {
    method: 'POST',
    body: {
      provider: { ...provider, model: 'fictional-model' },
      accountId: account.id,
      currency: 'HKD',
      dateOrder: 'YMD',
      statementText: `${today} Integration merchant 12.34 DR`,
    },
  })
  assert.equal(repeatedParse.response.status, 200)
  assert.equal(repeatedParse.payload.data.drafts[0].importKey, draft.importKey)
  assert.notEqual(repeatedParse.payload.data.drafts[0].id, draft.id)

  const repeatedDraft = repeatedParse.payload.data.drafts[0]
  const repeatedPreview = await api(baseUrl, '/api/imports/ai', {
    method: 'POST',
    body: {
      mode: 'preview',
      rows: [{
        ...aiImportRows[0],
        id: repeatedDraft.id,
        importKey: repeatedDraft.importKey,
      }],
    },
  })
  assert.equal(repeatedPreview.response.status, 200)
  assert.equal(repeatedPreview.payload.data.rows[0].status, 'already_imported')

  const deleted = await api(baseUrl, `/api/transactions/${draft.id}`, {
    method: 'DELETE',
    body: { updatedAt: importedTransaction.payload.data.updatedAt },
  })
  assert.equal(deleted.response.status, 200)
  const tombstonePreview = await api(baseUrl, '/api/imports/ai', {
    method: 'POST',
    body: { mode: 'preview', rows: aiImportRows },
  })
  assert.equal(tombstonePreview.response.status, 200)
  assert.equal(tombstonePreview.payload.data.rows[0].status, 'already_imported')

  return { nextAiDrafts: 1, nextAiD1Writes: 1, nextAiTombstones: 1 }
}

async function stopWorker() {
  if (!workerProcess || workerProcess.exitCode !== null) return
  workerProcess.kill('SIGINT')
  await Promise.race([
    new Promise((resolveExit) => workerProcess.once('exit', resolveExit)),
    new Promise((resolveTimeout) =>
      setTimeout(() => {
        if (workerProcess.exitCode === null) workerProcess.kill('SIGKILL')
        resolveTimeout()
      }, 3_000),
    ),
  ])
}

async function stopNext() {
  if (!nextProcess || nextProcess.exitCode !== null) return
  nextProcess.kill('SIGINT')
  await Promise.race([
    new Promise((resolveExit) => nextProcess.once('exit', resolveExit)),
    new Promise((resolveTimeout) =>
      setTimeout(() => {
        if (nextProcess.exitCode === null) nextProcess.kill('SIGKILL')
        resolveTimeout()
      }, 3_000),
    ),
  ])
}

async function stopProvider() {
  if (!providerServer?.listening) return
  await new Promise((resolveClosed, reject) =>
    providerServer.close((error) => (error ? reject(error) : resolveClosed())),
  )
}

try {
  if (!skipBuild) await runCommand(openNext, ['build'], 'opennextjs-cloudflare')
  await runWrangler(['d1', 'migrations', 'apply', 'hushledger', '--local', '--persist-to', freshState])
  await seedCsvExportRows()
  await verifyUpgradeMigration()
  const apiEvidence = await verifyWorkerApi()
  await stopWorker()
  const nextAiEvidence = await verifyNextAiDrafts()
  console.log(
    JSON.stringify({
      ok: true,
      runtime: 'next-open-next-workerd',
      freshMigrations: '0001-0010',
      upgradeMigration: '0004-to-0010-preserved-data-names-clearing-and-null-plans',
      ...apiEvidence,
      ...nextAiEvidence,
    }),
  )
} finally {
  await stopWorker()
  await stopNext()
  await stopProvider()
  await rm(temporaryRoot, { recursive: true, force: true })
}
