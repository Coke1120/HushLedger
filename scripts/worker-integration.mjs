import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
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
    `SELECT id, occurred_on AS occurredOn FROM transactions WHERE id = '${sentinelId}';
     SELECT name, localization_key AS localizationKey FROM accounts WHERE name IN ('日常帳戶','Integration custom account') ORDER BY name;
     SELECT name, localization_key AS localizationKey FROM categories WHERE name IN ('生活','Integration custom category') ORDER BY name;
     PRAGMA foreign_key_check;`,
    '--json',
  ])
  const statements = JSON.parse(verification.stdout)
  assert.equal(statements[0].results[0].id, sentinelId)
  assert.equal(statements[0].results[0].occurredOn, '2026-07-10')
  assert.deepEqual(statements[1].results, [
    { name: 'Integration custom account', localizationKey: null },
    { name: '日常帳戶', localizationKey: 'account.bank' },
  ])
  assert.deepEqual(statements[2].results, [
    { name: 'Integration custom category', localizationKey: null },
    { name: '生活', localizationKey: 'category.living' },
  ])
  assert.deepEqual(statements[3].results, [])
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
  const payload = contentType.includes('application/json') ? await response.json() : await response.text()
  return { response, payload }
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
  const accountsResult = await api(baseUrl, '/api/accounts')
  const categoriesResult = await api(baseUrl, '/api/categories')
  assert.equal(accountsResult.response.status, 200)
  assert.equal(categoriesResult.response.status, 200)
  assert.match(accountsResult.response.headers.get('cache-control') ?? '', /no-store/)

  const duplicateMonth = await api(baseUrl, `/api/transactions?month=${month}&month=${month}`)
  assert.equal(duplicateMonth.response.status, 400)
  assert.equal(duplicateMonth.payload.error.code, 'INVALID_QUERY')

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
  const account = accountsResult.payload.data.find((item) => item.isActive)
  const expenseCategory = categoriesResult.payload.data.find((item) => item.isActive && item.type === 'expense')
  assert(account)
  assert(expenseCategory)

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

  const ruleIds = {
    daily: '20000000-0000-4000-8000-000000000001',
    weekly: '20000000-0000-4000-8000-000000000002',
    monthly: '20000000-0000-4000-8000-000000000003',
    cron: '20000000-0000-4000-8000-000000000004',
    race: '20000000-0000-4000-8000-000000000007',
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
  assert(
    beforeDelete.payload.data
      .filter((item) => item.recurrenceDueOn === today)
      .every(
        (item) =>
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

  return { createdRules: createdRules.length, firstRunCreated: firstRun.payload.data.created, cronCreated: 1 }
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

  const afterTransactions = await api(baseUrl, `/api/transactions?month=${month}`)
  assert.equal(afterTransactions.response.status, 200)
  assert.deepEqual(
    afterTransactions.payload.data.map(({ id }) => id),
    beforeTransactions.payload.data.map(({ id }) => id),
  )
  return { nextAiDrafts: 1, nextAiD1Writes: 0 }
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
  await verifyUpgradeMigration()
  const apiEvidence = await verifyWorkerApi()
  await stopWorker()
  const nextAiEvidence = await verifyNextAiDrafts()
  console.log(
    JSON.stringify({
      ok: true,
      runtime: 'next-open-next-workerd',
      freshMigrations: '0001-0006',
      upgradeMigration: '0004-to-0006-preserved-data-and-custom-names',
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
