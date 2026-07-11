import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const wrangler = join(projectRoot, 'node_modules', '.bin', 'wrangler')
const temporaryRoot = await mkdtemp(join(tmpdir(), 'hushledger-integration-'))
const freshState = join(temporaryRoot, 'fresh-state')
const upgradeState = join(temporaryRoot, 'upgrade-state')
let workerProcess

function hktCalendarDate() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

async function availablePort() {
  const server = createServer()
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

function runWrangler(args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(wrangler, args, {
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
      else reject(new Error(`wrangler ${args.join(' ')} failed (${code})\n${stderr || stdout}`))
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
  await writeFile(
    upgradeConfig,
    JSON.stringify({
      name: 'hushledger-upgrade-verification',
      main: join(projectRoot, 'worker', 'index.ts'),
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
    `INSERT INTO transactions(id,type,amount_minor,currency,account_id,category_id,occurred_on,payee,note) VALUES ('${sentinelId}','expense',123,'HKD',1,3,'2026-07-10','upgrade sentinel','');`,
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
    `SELECT id, occurred_on AS occurredOn FROM transactions WHERE id = '${sentinelId}'; PRAGMA foreign_key_check;`,
    '--json',
  ])
  const statements = JSON.parse(verification.stdout)
  assert.equal(statements[0].results[0].id, sentinelId)
  assert.equal(statements[0].results[0].occurredOn, '2026-07-10')
  assert.deepEqual(statements[1].results, [])
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

async function verifyWorkerApi() {
  const port = await availablePort()
  const inspectorPort = await availablePort()
  const baseUrl = `http://127.0.0.1:${port}`
  workerProcess = startWorker(port, inspectorPort)
  await waitForHealth(baseUrl)

  const today = hktCalendarDate()
  const month = today.slice(0, 7)
  const accountsResult = await api(baseUrl, '/api/accounts')
  const categoriesResult = await api(baseUrl, '/api/categories')
  assert.equal(accountsResult.response.status, 200)
  assert.equal(categoriesResult.response.status, 200)
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

try {
  await runWrangler(['d1', 'migrations', 'apply', 'hushledger', '--local', '--persist-to', freshState])
  await verifyUpgradeMigration()
  const apiEvidence = await verifyWorkerApi()
  console.log(
    JSON.stringify({
      ok: true,
      freshMigrations: '0001-0005',
      upgradeMigration: '0004-to-0005-preserved-sentinel',
      ...apiEvidence,
    }),
  )
} finally {
  await stopWorker()
  await rm(temporaryRoot, { recursive: true, force: true })
}
