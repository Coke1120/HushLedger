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
const supportsProcessGroups = process.platform !== 'win32'
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

function shiftCalendarYear(date, amount) {
  const [year, month, day] = date.split('-').map(Number)
  const shiftedYear = year + amount
  const monthEnd = new Date(Date.UTC(shiftedYear, month, 0)).getUTCDate()
  return `${shiftedYear}-${String(month).padStart(2, '0')}-${String(Math.min(day, monthEnd)).padStart(2, '0')}`
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

function withoutAccountOpeningBalances(accounts) {
  return accounts.map(({ openingBalanceMinor, openingBalanceOn, ...account }) => {
    assert(openingBalanceMinor === null || Number.isSafeInteger(openingBalanceMinor))
    assert(openingBalanceOn === null || typeof openingBalanceOn === 'string')
    return account
  })
}

function withoutRecurringTransferData(backup) {
  const compatible = structuredClone(backup)
  const recurringTransferRules = compatible.data.recurringTransferRules
  assert(Array.isArray(recurringTransferRules))
  delete compatible.data.recurringTransferRules
  compatible.data.accountTransfers = compatible.data.accountTransfers.map(({
    recurringTransferRuleId,
    recurringTransferRuleName,
    recurrenceDueOn,
    recurringOccurrenceKey,
    ...transfer
  }) => {
    assert(recurringTransferRuleId === null || typeof recurringTransferRuleId === 'string')
    assert(recurringTransferRuleName === null || typeof recurringTransferRuleName === 'string')
    assert(recurrenceDueOn === null || typeof recurrenceDueOn === 'string')
    assert(recurringOccurrenceKey === null || typeof recurringOccurrenceKey === 'string')
    return transfer
  })
  return compatible
}

function withoutRecurringScheduleEnds(backup) {
  const compatible = withoutRecurringTransferData(backup)
  compatible.data.recurringRules = compatible.data.recurringRules.map(({
    scheduleEndsOn,
    ...rule
  }) => {
    assert(scheduleEndsOn === null || typeof scheduleEndsOn === 'string')
    return rule
  })
  return compatible
}

function withoutYearlyRecurringData(backup) {
  const compatible = withoutRecurringScheduleEnds(backup)
  const yearlyRuleIds = new Set(
    compatible.data.recurringRules
      .filter(({ frequency }) => frequency === 'yearly')
      .map(({ id }) => id),
  )
  const removedTransactionIds = new Set(
    compatible.data.transactions
      .filter(({ recurringRuleId }) => yearlyRuleIds.has(recurringRuleId))
      .map(({ id }) => id),
  )
  compatible.data.recurringRules = compatible.data.recurringRules.filter(
    ({ id }) => !yearlyRuleIds.has(id),
  )
  compatible.data.transactions = compatible.data.transactions.filter(
    ({ id }) => !removedTransactionIds.has(id),
  )
  compatible.data.transactionImportKeys = compatible.data.transactionImportKeys.filter(
    ({ transactionId }) => !removedTransactionIds.has(transactionId),
  )
  return compatible
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
  const subsetDirectory = join(temporaryRoot, 'migrations-under-test')
  await mkdir(subsetDirectory)
  const allMigrationNames = (await readdir(join(projectRoot, 'migrations')))
    .filter((name) => /^\d{4}_.*\.sql$/.test(name))
    .sort()
  const initialMigrationNames = allMigrationNames.filter((name) => /^000[1-4]_/.test(name))
  const preYearlyMigrationNames = allMigrationNames.filter((name) => (
    /^000[5-9]_/.test(name) || /^001[0-4]_/.test(name)
  ))
  const yearlyMigrationNames = allMigrationNames.filter((name) => /^0015_/.test(name))
  const scheduleEndMigrationNames = allMigrationNames.filter((name) => /^0016_/.test(name))
  const recurringTransferMigrationNames = allMigrationNames.filter((name) => /^0017_/.test(name))
  assert.equal(initialMigrationNames.length, 4)
  assert.equal(preYearlyMigrationNames.length, 10)
  assert.deepEqual(yearlyMigrationNames, ['0015_yearly_recurring_rules.sql'])
  assert.deepEqual(scheduleEndMigrationNames, ['0016_recurring_rule_end_dates.sql'])
  assert.deepEqual(recurringTransferMigrationNames, ['0017_recurring_transfer_rules.sql'])
  await Promise.all(
    initialMigrationNames.map((name) => (
      copyFile(join(projectRoot, 'migrations', name), join(subsetDirectory, name))
    )),
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

  await Promise.all(
    preYearlyMigrationNames.map((name) => (
      copyFile(join(projectRoot, 'migrations', name), join(subsetDirectory, name))
    )),
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

  const recurringSentinelId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  const recurringTransactionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
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
    `INSERT INTO recurring_rules(
       id,name,type,amount_minor,currency,account_id,category_id,frequency,
       schedule_starts_on,next_occurrence_on,last_occurrence_on,anchor_day,
       is_active,payee,note,generated_count,revision,cursor_version
     ) VALUES (
       '${recurringSentinelId}','upgrade recurring sentinel','expense',777,'HKD',1,3,'monthly',
       '2024-01-31','2026-07-31','2026-06-30',31,
       1,'upgrade recurring payee','preserve every field',9,4,7
     );
     INSERT INTO transactions(
       id,type,amount_minor,currency,account_id,category_id,occurred_on,payee,note,
       recurring_rule_id,recurring_rule_name,recurrence_due_on,recurring_occurrence_key,cleared
     ) VALUES (
       '${recurringTransactionId}','expense',777,'HKD',1,3,'2026-06-30','upgrade recurring payee','generated before 0015',
       '${recurringSentinelId}','upgrade recurring sentinel','2026-06-30','${recurringSentinelId}:2026-06-30',0
     );`,
    '--yes',
  ])

  await Promise.all(
    yearlyMigrationNames.map((name) => (
      copyFile(join(projectRoot, 'migrations', name), join(subsetDirectory, name))
    )),
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

  await Promise.all(
    scheduleEndMigrationNames.map((name) => (
      copyFile(join(projectRoot, 'migrations', name), join(subsetDirectory, name))
    )),
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

  const transferSentinelId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
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
    `INSERT INTO account_transfers(
       id,amount_minor,currency,from_account_id,to_account_id,occurred_on,
       from_cleared,to_cleared,note,created_at,updated_at
     ) VALUES (
       '${transferSentinelId}',333,'HKD',1,2,'2026-07-11',1,0,
       'preserve manual transfer','2026-07-11T01:02:03.000Z','2026-07-12T04:05:06.000Z'
     );`,
    '--yes',
  ])

  await Promise.all(
    recurringTransferMigrationNames.map((name) => (
      copyFile(join(projectRoot, 'migrations', name), join(subsetDirectory, name))
    )),
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

  const verification = await runWrangler([
    'd1',
    'execute',
    'hushledger',
    '--local',
    '--persist-to',
    upgradeState,
    '--command',
    `SELECT id, occurred_on AS occurredOn, cleared FROM transactions WHERE id = '${sentinelId}';
     SELECT name, localization_key AS localizationKey,
       opening_balance_minor AS openingBalanceMinor,
       opening_balance_on AS openingBalanceOn
     FROM accounts WHERE name IN ('日常帳戶','Integration custom account') ORDER BY name;
     SELECT name, localization_key AS localizationKey, monthly_plan_minor AS monthlyPlanMinor FROM categories WHERE name IN ('生活','Integration custom category') ORDER BY name;
     SELECT id, frequency, schedule_starts_on AS scheduleStartsOn,
       schedule_ends_on AS scheduleEndsOn,
       next_occurrence_on AS nextOccurrenceOn, last_occurrence_on AS lastOccurrenceOn,
       anchor_day AS anchorDay, generated_count AS generatedCount,
       revision, cursor_version AS cursorVersion
     FROM recurring_rules WHERE id = '${recurringSentinelId}';
     SELECT id, recurring_rule_id AS recurringRuleId,
       recurrence_due_on AS recurrenceDueOn,
       recurring_occurrence_key AS recurringOccurrenceKey, cleared
     FROM transactions WHERE id = '${recurringTransactionId}';
     SELECT
       id,
       amount_minor AS amountMinor,
       currency,
       from_account_id AS fromAccountId,
       to_account_id AS toAccountId,
       occurred_on AS occurredOn,
       from_cleared AS fromCleared,
       to_cleared AS toCleared,
       note,
       recurring_transfer_rule_id AS recurringTransferRuleId,
       recurring_transfer_rule_name AS recurringTransferRuleName,
       recurrence_due_on AS recurrenceDueOn,
       recurring_occurrence_key AS recurringOccurrenceKey,
       created_at AS createdAt,
       updated_at AS updatedAt
     FROM account_transfers WHERE id = '${transferSentinelId}';
     SELECT COUNT(*) AS importKeys FROM transaction_import_keys;
     SELECT revision FROM ledger_state WHERE id = 1;
     SELECT name FROM sqlite_master
     WHERE type = 'table' AND name IN (
       'account_transfers', 'emergency_fund_goals', 'ledger_settings', 'recurring_transfer_rules'
     )
     ORDER BY name;
     SELECT COUNT(*) AS emergencyFundRevisionTriggers
     FROM sqlite_master
     WHERE type = 'trigger' AND name LIKE 'ledger_revision_emergency_fund_goals_%';
     SELECT COUNT(*) AS recurringAndTransactionIndexes
     FROM sqlite_master
     WHERE type = 'index' AND name IN (
       'idx_recurring_rules_due', 'idx_recurring_rules_account', 'idx_recurring_rules_category',
       'idx_transactions_occurred_on', 'idx_transactions_type_occurred_on',
       'idx_transactions_account_occurred_on', 'idx_transactions_category_occurred_on',
       'idx_transactions_recurring_rule', 'idx_transactions_cleared_occurred_on'
     );
     SELECT COUNT(*) AS recurringAndTransactionRevisionTriggers
     FROM sqlite_master
     WHERE type = 'trigger' AND (
       name LIKE 'ledger_revision_recurring_rules_%'
       OR name LIKE 'ledger_revision_transactions_%'
     );
     SELECT COUNT(*) AS recurringTransferIndexes
     FROM sqlite_master
     WHERE type = 'index' AND name IN (
       'idx_recurring_transfer_rules_due',
       'idx_recurring_transfer_rules_from_account',
       'idx_recurring_transfer_rules_to_account',
       'idx_account_transfers_recurring_transfer_rule'
     );
     SELECT COUNT(*) AS recurringTransferTriggers
     FROM sqlite_master
     WHERE type = 'trigger' AND (
       name LIKE 'ledger_revision_recurring_transfer_rules_%'
       OR name LIKE 'ledger_revision_account_transfers_%'
       OR name = 'account_transfers_recurring_provenance_update_guard'
     );
     SELECT currency, updated_at AS updatedAt FROM ledger_settings WHERE id = 1;
     SELECT
       (SELECT COUNT(*) FROM accounts WHERE currency <> ledger_settings.currency) AS accountMismatches,
       (SELECT COUNT(*) FROM transactions WHERE currency <> ledger_settings.currency) AS transactionMismatches,
       (SELECT COUNT(*) FROM recurring_rules WHERE currency <> ledger_settings.currency) AS recurringRuleMismatches,
       (SELECT COUNT(*) FROM recurring_transfer_rules WHERE currency <> ledger_settings.currency) AS recurringTransferRuleMismatches,
       (SELECT COUNT(*) FROM account_transfers WHERE currency <> ledger_settings.currency) AS transferMismatches
     FROM ledger_settings WHERE id = 1;
     PRAGMA foreign_key_check;`,
    '--json',
  ])
  const statements = JSON.parse(verification.stdout)
  assert.equal(statements[0].results[0].id, sentinelId)
  assert.equal(statements[0].results[0].occurredOn, '2026-07-10')
  assert.equal(statements[0].results[0].cleared, 1)
  assert.deepEqual(statements[1].results, [
    { name: 'Integration custom account', localizationKey: null, openingBalanceMinor: null, openingBalanceOn: null },
    { name: '日常帳戶', localizationKey: 'account.bank', openingBalanceMinor: null, openingBalanceOn: null },
  ])
  assert.deepEqual(statements[2].results, [
    { name: 'Integration custom category', localizationKey: null, monthlyPlanMinor: null },
    { name: '生活', localizationKey: 'category.living', monthlyPlanMinor: null },
  ])
  assert.deepEqual(statements[3].results, [{
    id: recurringSentinelId,
    frequency: 'monthly',
    scheduleStartsOn: '2024-01-31',
    scheduleEndsOn: null,
    nextOccurrenceOn: '2026-07-31',
    lastOccurrenceOn: '2026-06-30',
    anchorDay: 31,
    generatedCount: 9,
    revision: 4,
    cursorVersion: 7,
  }])
  assert.deepEqual(statements[4].results, [{
    id: recurringTransactionId,
    recurringRuleId: recurringSentinelId,
    recurrenceDueOn: '2026-06-30',
    recurringOccurrenceKey: `${recurringSentinelId}:2026-06-30`,
    cleared: 0,
  }])
  assert.deepEqual(statements[5].results, [{
    id: transferSentinelId,
    amountMinor: 333,
    currency: 'HKD',
    fromAccountId: 1,
    toAccountId: 2,
    occurredOn: '2026-07-11',
    fromCleared: 1,
    toCleared: 0,
    note: 'preserve manual transfer',
    recurringTransferRuleId: null,
    recurringTransferRuleName: null,
    recurrenceDueOn: null,
    recurringOccurrenceKey: null,
    createdAt: '2026-07-11T01:02:03.000Z',
    updatedAt: '2026-07-12T04:05:06.000Z',
  }])
  assert.equal(statements[6].results[0].importKeys, 0)
  assert.equal(statements[7].results[0].revision, 4)
  assert.deepEqual(statements[8].results, [
    { name: 'account_transfers' },
    { name: 'emergency_fund_goals' },
    { name: 'ledger_settings' },
    { name: 'recurring_transfer_rules' },
  ])
  assert.equal(statements[9].results[0].emergencyFundRevisionTriggers, 3)
  assert.equal(statements[10].results[0].recurringAndTransactionIndexes, 9)
  assert.equal(statements[11].results[0].recurringAndTransactionRevisionTriggers, 6)
  assert.equal(statements[12].results[0].recurringTransferIndexes, 4)
  assert.equal(statements[13].results[0].recurringTransferTriggers, 7)
  assert.equal(statements[14].results[0].currency, 'HKD')
  assert.match(statements[14].results[0].updatedAt, /Z$/)
  assert.deepEqual(statements[15].results, [{
    accountMismatches: 0,
    transactionMismatches: 0,
    recurringRuleMismatches: 0,
    recurringTransferRuleMismatches: 0,
    transferMismatches: 0,
  }])
  assert.deepEqual(statements[16].results, [])

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
    `UPDATE recurring_rules SET frequency = 'yearly' WHERE id = '${recurringSentinelId}';`,
    '--yes',
  ])
  const yearlyFrequency = JSON.parse((await runWrangler([
    'd1',
    'execute',
    'hushledger',
    '--local',
    '--persist-to',
    upgradeState,
    '--config',
    upgradeConfig,
    '--command',
    `SELECT frequency FROM recurring_rules WHERE id = '${recurringSentinelId}';`,
    '--json',
  ])).stdout)
  assert.deepEqual(yearlyFrequency[0].results, [{ frequency: 'yearly' }])

  await assert.rejects(
    runWrangler([
      'd1',
      'execute',
      'hushledger',
      '--local',
      '--persist-to',
      upgradeState,
      '--config',
      upgradeConfig,
      '--command',
      `UPDATE recurring_rules SET frequency = 'quarterly' WHERE id = '${recurringSentinelId}';`,
      '--yes',
    ]),
    /CHECK constraint failed/,
  )

  const migrationTransferRuleId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
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
    `INSERT INTO recurring_transfer_rules(
       id,name,amount_minor,currency,from_account_id,to_account_id,frequency,
       schedule_starts_on,schedule_ends_on,next_occurrence_on,anchor_day,is_active,note
     ) VALUES (
       '${migrationTransferRuleId}','migration transfer rule',100,'HKD',1,2,'monthly',
       '2026-07-01','2026-07-31','2026-07-31',1,1,''
     );`,
    '--yes',
  ])

  for (const invalidRuleSql of [
    `INSERT INTO recurring_transfer_rules(
       id,name,amount_minor,currency,from_account_id,to_account_id,frequency,
       schedule_starts_on,next_occurrence_on,anchor_day,is_active,note
     ) VALUES (
       'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1','same account',100,'HKD',1,1,'daily',
       '2026-07-01','2026-07-01',1,1,''
     );`,
    `INSERT INTO recurring_transfer_rules(
       id,name,amount_minor,currency,from_account_id,to_account_id,frequency,
       schedule_starts_on,schedule_ends_on,next_occurrence_on,anchor_day,is_active,note
     ) VALUES (
       'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2','bad end',100,'HKD',1,2,'daily',
       '2026-07-02','2026-07-01','2026-07-02',2,1,''
     );`,
    `INSERT INTO recurring_transfer_rules(
       id,name,amount_minor,currency,from_account_id,to_account_id,frequency,
       schedule_starts_on,next_occurrence_on,anchor_day,is_active,note
     ) VALUES (
       'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3','unsafe amount',9007199254740992,'HKD',1,2,'daily',
       '2026-07-01','2026-07-01',1,1,''
     );`,
  ]) {
    await assert.rejects(
      runWrangler([
        'd1',
        'execute',
        'hushledger',
        '--local',
        '--persist-to',
        upgradeState,
        '--config',
        upgradeConfig,
        '--command',
        invalidRuleSql,
        '--yes',
      ]),
      /CHECK constraint failed/,
    )
  }

  for (const invalidTransferSql of [
    `INSERT INTO account_transfers(
       id,amount_minor,currency,from_account_id,to_account_id,occurred_on,
       recurring_transfer_rule_id,note
     ) VALUES (
       'ffffffff-ffff-4fff-8fff-fffffffffff1',100,'HKD',1,2,'2026-07-31',
       '${migrationTransferRuleId}','partial provenance'
     );`,
    `INSERT INTO account_transfers(
       id,amount_minor,currency,from_account_id,to_account_id,occurred_on,
       recurring_transfer_rule_id,recurring_transfer_rule_name,recurrence_due_on,
       recurring_occurrence_key,note
     ) VALUES (
       'ffffffff-ffff-4fff-8fff-fffffffffff2',100,'HKD',1,2,'2026-07-31',
       '${migrationTransferRuleId}','migration transfer rule','2026-07-31',
       '${migrationTransferRuleId}:2026-07-30','wrong occurrence key'
     );`,
  ]) {
    await assert.rejects(
      runWrangler([
        'd1',
        'execute',
        'hushledger',
        '--local',
        '--persist-to',
        upgradeState,
        '--config',
        upgradeConfig,
        '--command',
        invalidTransferSql,
        '--yes',
      ]),
      /CHECK constraint failed/,
    )
  }

  await assert.rejects(
    runWrangler([
      'd1',
      'execute',
      'hushledger',
      '--local',
      '--persist-to',
      upgradeState,
      '--config',
      upgradeConfig,
      '--command',
      `UPDATE account_transfers
       SET
         recurring_transfer_rule_id = '${migrationTransferRuleId}',
         recurring_transfer_rule_name = 'migration transfer rule',
         recurrence_due_on = '2026-07-31',
         recurring_occurrence_key = '${migrationTransferRuleId}:2026-07-31'
       WHERE id = '${transferSentinelId}';`,
      '--yes',
    ]),
    /recurring transfer provenance is immutable/,
  )

  await assert.rejects(
    runWrangler([
      'd1',
      'execute',
      'hushledger',
      '--local',
      '--persist-to',
      upgradeState,
      '--config',
      upgradeConfig,
      '--command',
      `UPDATE recurring_rules SET schedule_ends_on = '2023-12-31' WHERE id = '${recurringSentinelId}';`,
      '--yes',
    ]),
    /CHECK constraint failed/,
  )

  await assert.rejects(
    runWrangler([
      'd1',
      'execute',
      'hushledger',
      '--local',
      '--persist-to',
      upgradeState,
      '--command',
      "UPDATE ledger_settings SET currency = 'USD' WHERE id = 1;",
      '--yes',
    ]),
    /ledger currency is locked by monetary history/,
  )
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
     WITH RECURSIVE sequence(value) AS (
       SELECT 1
       UNION ALL
       SELECT value + 1 FROM sequence WHERE value < 205
     )
     INSERT INTO transactions(id,type,amount_minor,currency,account_id,category_id,occurred_on,payee,note)
     SELECT printf('31000000-0000-4000-8000-%012d', value),'income',100 + value,'HKD',1,1,'${today}','',''
     FROM sequence;
     INSERT INTO transactions(id,type,amount_minor,currency,account_id,category_id,occurred_on,payee,note)
     VALUES('31000000-0000-4000-8000-000000999999','income',50000,'HKD',1,2,'${today}','','');
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
      detached: supportsProcessGroups,
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
      detached: supportsProcessGroups,
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

function exportTransactionCsv(baseUrl, body) {
  return api(baseUrl, '/api/exports/transactions', { method: 'POST', body })
}

function exportAccountRegisterCsv(baseUrl, body, { origin = baseUrl } = {}) {
  return api(baseUrl, '/api/exports/account-register', {
    method: 'POST',
    origin,
    body,
  })
}

function downloadLedgerBackup(baseUrl, { origin = baseUrl } = {}) {
  return api(baseUrl, '/api/backups/ledger', {
    method: 'POST',
    origin,
    body: { mode: 'export' },
  })
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

async function verifyPristineCurrencyApi() {
  const port = await availablePort()
  const inspectorPort = await availablePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const today = hktCalendarDate()
  workerProcess = startWorker(port, inspectorPort)
  await waitForHealth(baseUrl)

  let evidence
  let createdAccountId
  try {
    const initial = await api(baseUrl, '/api/ledger-settings')
    assert.equal(initial.response.status, 200, JSON.stringify(initial.payload))
    assert.match(initial.response.headers.get('cache-control') ?? '', /no-store/)
    assert.equal(initial.payload.data.currency, 'HKD')
    assert.equal(initial.payload.data.canChangeCurrency, true)
    assert.match(initial.payload.data.updatedAt, /Z$/)

    const crossOrigin = await api(baseUrl, '/api/ledger-settings', {
      method: 'PUT',
      origin: 'https://attacker.invalid',
      body: { currency: 'USD', expectedUpdatedAt: initial.payload.data.updatedAt },
    })
    assert.equal(crossOrigin.response.status, 403)
    assert.equal(crossOrigin.payload.error.code, 'ORIGIN_FORBIDDEN')

    const unsupported = await api(baseUrl, '/api/ledger-settings', {
      method: 'PUT',
      body: { currency: 'JPY', expectedUpdatedAt: initial.payload.data.updatedAt },
    })
    assert.equal(unsupported.response.status, 400)
    assert.equal(unsupported.payload.error.code, 'LEDGER_CURRENCY_UNSUPPORTED')

    const changed = await api(baseUrl, '/api/ledger-settings', {
      method: 'PUT',
      body: { currency: 'USD', expectedUpdatedAt: initial.payload.data.updatedAt },
    })
    assert.equal(changed.response.status, 200, JSON.stringify(changed.payload))
    assert.equal(changed.payload.data.currency, 'USD')
    assert.equal(changed.payload.data.canChangeCurrency, true)
    assert.notEqual(changed.payload.data.updatedAt, initial.payload.data.updatedAt)

    const stale = await api(baseUrl, '/api/ledger-settings', {
      method: 'PUT',
      body: { currency: 'EUR', expectedUpdatedAt: initial.payload.data.updatedAt },
    })
    assert.equal(stale.response.status, 409)
    assert.equal(stale.payload.error.code, 'LEDGER_CURRENCY_VERSION_CONFLICT')

    const cascadedAccounts = await api(baseUrl, '/api/accounts')
    const pristineCategories = await api(baseUrl, '/api/categories')
    assert.equal(cascadedAccounts.response.status, 200)
    assert.equal(pristineCategories.response.status, 200)
    assert(cascadedAccounts.payload.data.length > 0)
    assert(cascadedAccounts.payload.data.every(({ currency }) => currency === 'USD'))
    const existingAccount = cascadedAccounts.payload.data.find(({ type }) => type === 'bank')
    const existingCategory = pristineCategories.payload.data.find(({ type }) => type === 'expense')
    assert(existingAccount)
    assert(existingCategory)

    const staleMoneyRequests = await Promise.all([
      api(baseUrl, '/api/accounts', {
        method: 'POST',
        body: {
          name: 'Stale currency account',
          type: 'bank',
          expectedCurrency: 'HKD',
          openingBalanceMinor: 50_000,
          openingBalanceOn: today,
        },
      }),
      api(baseUrl, `/api/accounts/${existingAccount.id}`, {
        method: 'PUT',
        body: {
          name: existingAccount.name,
          type: existingAccount.type,
          expectedCurrency: 'HKD',
          openingBalanceMinor: 50_000,
          openingBalanceOn: today,
          updatedAt: existingAccount.updatedAt,
        },
      }),
      api(baseUrl, '/api/categories', {
        method: 'POST',
        body: {
          name: 'Stale currency category',
          type: 'expense',
          expectedCurrency: 'HKD',
          monthlyPlanMinor: 50_000,
        },
      }),
      api(baseUrl, `/api/categories/${existingCategory.id}`, {
        method: 'PUT',
        body: {
          name: existingCategory.name,
          type: existingCategory.type,
          expectedCurrency: 'HKD',
          monthlyPlanMinor: 50_000,
          updatedAt: existingCategory.updatedAt,
        },
      }),
      api(baseUrl, '/api/emergency-fund-goal', {
        method: 'PUT',
        body: {
          accountId: existingAccount.id,
          targetMinor: 50_000,
          expectedCurrency: 'HKD',
          expectedUpdatedAt: null,
        },
      }),
    ])
    for (const result of staleMoneyRequests) {
      assert.equal(result.response.status, 409, JSON.stringify(result.payload))
      assert.equal(result.payload.error.code, 'LEDGER_CURRENCY_VERSION_CONFLICT')
    }

    const [accountsAfterStaleWrites, categoriesAfterStaleWrites, goalAfterStaleWrites, settingsAfterStaleWrites] = await Promise.all([
      api(baseUrl, '/api/accounts'),
      api(baseUrl, '/api/categories'),
      api(baseUrl, '/api/emergency-fund-goal'),
      api(baseUrl, '/api/ledger-settings'),
    ])
    assert.equal(accountsAfterStaleWrites.payload.data.length, cascadedAccounts.payload.data.length)
    assert(!accountsAfterStaleWrites.payload.data.some(({ name }) => name === 'Stale currency account'))
    assert(accountsAfterStaleWrites.payload.data.every(({
      openingBalanceMinor,
      openingBalanceOn,
    }) => openingBalanceMinor === null && openingBalanceOn === null))
    assert.equal(
      accountsAfterStaleWrites.payload.data.find(({ id }) => id === existingAccount.id)?.updatedAt,
      existingAccount.updatedAt,
    )
    assert.equal(categoriesAfterStaleWrites.payload.data.length, pristineCategories.payload.data.length)
    assert(!categoriesAfterStaleWrites.payload.data.some(({ name }) => name === 'Stale currency category'))
    assert(categoriesAfterStaleWrites.payload.data.every(({ monthlyPlanMinor }) => monthlyPlanMinor === null))
    assert.equal(
      categoriesAfterStaleWrites.payload.data.find(({ id }) => id === existingCategory.id)?.updatedAt,
      existingCategory.updatedAt,
    )
    assert.equal(goalAfterStaleWrites.payload.data, null)
    assert.equal(settingsAfterStaleWrites.payload.data.currency, 'USD')
    assert.equal(settingsAfterStaleWrites.payload.data.canChangeCurrency, true)

    const createdAccount = await api(baseUrl, '/api/accounts', {
      method: 'POST',
      body: {
        name: 'Currency integration account',
        type: 'bank',
        expectedCurrency: 'USD',
      },
    })
    assert.equal(createdAccount.response.status, 201, JSON.stringify(createdAccount.payload))
    assert.equal(createdAccount.payload.data.currency, 'USD')
    assert.equal(createdAccount.payload.data.openingBalanceMinor, null)
    assert.equal(createdAccount.payload.data.openingBalanceOn, null)
    createdAccountId = createdAccount.payload.data.id

    const usdBackupDownload = await downloadLedgerBackup(baseUrl)
    assert.equal(usdBackupDownload.response.status, 200, JSON.stringify(usdBackupDownload.payload))
    const usdBackup = usdBackupDownload.payload
    assert.equal(usdBackup.schemaVersion, 17)
    assert.equal(usdBackup.data.currency, 'USD')
    assert(usdBackup.data.accounts.every(({ currency }) => currency === 'USD'))
    assert(usdBackup.data.accounts.every(({
      openingBalanceMinor,
      openingBalanceOn,
    }) => openingBalanceMinor === null && openingBalanceOn === null))
    assert(usdBackup.data.categories.every(({ monthlyPlanMinor }) => monthlyPlanMinor === null))
    assert.deepEqual(usdBackup.data.transactions, [])
    assert.deepEqual(usdBackup.data.recurringRules, [])
    assert.deepEqual(usdBackup.data.recurringTransferRules, [])
    assert.deepEqual(usdBackup.data.transactionImportKeys, [])
    assert.deepEqual(usdBackup.data.accountTransfers, [])
    assert.deepEqual(usdBackup.data.emergencyFundGoals, [])

    const restored = await api(baseUrl, '/api/ledger-settings', {
      method: 'PUT',
      body: { currency: 'HKD', expectedUpdatedAt: changed.payload.data.updatedAt },
    })
    assert.equal(restored.response.status, 200, JSON.stringify(restored.payload))
    assert.equal(restored.payload.data.currency, 'HKD')
    assert.equal(restored.payload.data.canChangeCurrency, true)

    const restoredAccounts = await api(baseUrl, '/api/accounts')
    assert.equal(restoredAccounts.response.status, 200)
    assert(restoredAccounts.payload.data.every(({ currency }) => currency === 'HKD'))

    const hkdBackupDownload = await downloadLedgerBackup(baseUrl)
    assert.equal(hkdBackupDownload.response.status, 200, JSON.stringify(hkdBackupDownload.payload))
    const hkdBackup = hkdBackupDownload.payload
    assert.equal(hkdBackup.data.currency, 'HKD')

    const ruleOnlyCurrencyLock = await api(baseUrl, '/api/recurring-transfer-rules', {
      method: 'POST',
      body: {
        id: '10000000-0000-4000-8000-000000000017',
        name: 'Rule-only currency lock',
        amountMinor: 10_000,
        currency: 'HKD',
        fromAccountId: existingAccount.id,
        toAccountId: createdAccountId,
        frequency: 'monthly',
        scheduleStartsOn: today,
        isActive: true,
        note: '',
      },
    })
    assert.equal(ruleOnlyCurrencyLock.response.status, 201, JSON.stringify(ruleOnlyCurrencyLock.payload))
    const lockedByRuleSettings = await api(baseUrl, '/api/ledger-settings')
    assert.equal(lockedByRuleSettings.response.status, 200)
    assert.equal(lockedByRuleSettings.payload.data.currency, 'HKD')
    assert.equal(lockedByRuleSettings.payload.data.canChangeCurrency, false)
    const blockedByRuleCurrencyChange = await api(baseUrl, '/api/ledger-settings', {
      method: 'PUT',
      body: {
        currency: 'USD',
        expectedUpdatedAt: lockedByRuleSettings.payload.data.updatedAt,
      },
    })
    assert.equal(blockedByRuleCurrencyChange.response.status, 409)
    assert.equal(blockedByRuleCurrencyChange.payload.error.code, 'LEDGER_CURRENCY_LOCKED')

    await stopWorker()
    await assert.rejects(
      runWrangler([
        'd1',
        'execute',
        'hushledger',
        '--local',
        '--persist-to',
        freshState,
        '--command',
        "UPDATE ledger_settings SET currency = 'USD' WHERE id = 1;",
        '--yes',
      ]),
      /ledger currency is locked by monetary history/,
    )
    workerProcess = startWorker(port, inspectorPort)
    await waitForHealth(baseUrl)

    const usdPreview = await api(baseUrl, '/api/backups/ledger', {
      method: 'POST',
      body: { mode: 'preview', backup: usdBackup },
    })
    assert.equal(usdPreview.response.status, 200, JSON.stringify(usdPreview.payload))
    assert.equal(usdPreview.payload.data.currentCurrency, 'HKD')
    assert.equal(usdPreview.payload.data.backupCurrency, 'USD')
    const usdRestore = await api(baseUrl, '/api/backups/ledger', {
      method: 'POST',
      body: {
        mode: 'commit',
        backup: usdBackup,
        expectedCurrentDigest: usdPreview.payload.data.currentDigest,
        expectedRevision: usdPreview.payload.data.currentRevision,
        confirmation: 'RESTORE',
      },
    })
    assert.equal(usdRestore.response.status, 200, JSON.stringify(usdRestore.payload))

    const [restoredUsdSettings, restoredUsdAccounts] = await Promise.all([
      api(baseUrl, '/api/ledger-settings'),
      api(baseUrl, '/api/accounts'),
    ])
    assert.equal(restoredUsdSettings.payload.data.currency, 'USD')
    assert.equal(restoredUsdSettings.payload.data.canChangeCurrency, true)
    assert(restoredUsdAccounts.payload.data.every(({ currency }) => currency === 'USD'))

    await stopWorker()
    const usdDatabaseVerification = JSON.parse((await runWrangler([
      'd1',
      'execute',
      'hushledger',
      '--local',
      '--persist-to',
      freshState,
      '--command',
      `SELECT currency FROM ledger_settings WHERE id = 1;
       SELECT COUNT(*) AS accountMismatches
       FROM accounts
       WHERE currency <> (SELECT currency FROM ledger_settings WHERE id = 1);
       PRAGMA foreign_key_check;`,
      '--json',
    ])).stdout)
    assert.deepEqual(usdDatabaseVerification[0].results, [{ currency: 'USD' }])
    assert.deepEqual(usdDatabaseVerification[1].results, [{ accountMismatches: 0 }])
    assert.deepEqual(usdDatabaseVerification[2].results, [])

    const restorePort = await availablePort()
    const restoreInspectorPort = await availablePort()
    const restoreBaseUrl = `http://127.0.0.1:${restorePort}`
    workerProcess = startWorker(restorePort, restoreInspectorPort)
    await waitForHealth(restoreBaseUrl)
    const hkdPreview = await api(restoreBaseUrl, '/api/backups/ledger', {
      method: 'POST',
      body: { mode: 'preview', backup: hkdBackup },
    })
    assert.equal(hkdPreview.response.status, 200, JSON.stringify(hkdPreview.payload))
    assert.equal(hkdPreview.payload.data.currentCurrency, 'USD')
    assert.equal(hkdPreview.payload.data.backupCurrency, 'HKD')
    const hkdRestore = await api(restoreBaseUrl, '/api/backups/ledger', {
      method: 'POST',
      body: {
        mode: 'commit',
        backup: hkdBackup,
        expectedCurrentDigest: hkdPreview.payload.data.currentDigest,
        expectedRevision: hkdPreview.payload.data.currentRevision,
        confirmation: 'RESTORE',
      },
    })
    assert.equal(hkdRestore.response.status, 200, JSON.stringify(hkdRestore.payload))
    const [finalSettings, finalAccounts] = await Promise.all([
      api(restoreBaseUrl, '/api/ledger-settings'),
      api(restoreBaseUrl, '/api/accounts'),
    ])
    assert.equal(finalSettings.payload.data.currency, 'HKD')
    assert.equal(finalSettings.payload.data.canChangeCurrency, true)
    assert(finalAccounts.payload.data.every(({ currency }) => currency === 'HKD'))

    evidence = {
      pristineCurrencyChanges: 2,
      currencyRequestGuards: 9,
      recurringTransferCurrencyLocks: 1,
      currencyAccountCascades: 4,
      currencyBackupRestores: 2,
    }
  } finally {
    await stopWorker()
  }

  assert(Number.isSafeInteger(createdAccountId))
  const cleanupVerification = JSON.parse((await runWrangler([
    'd1',
    'execute',
    'hushledger',
    '--local',
    '--persist-to',
    freshState,
    '--command',
    `DELETE FROM accounts WHERE id = ${createdAccountId};
     SELECT currency FROM ledger_settings WHERE id = 1;
     SELECT COUNT(*) AS accountMismatches
     FROM accounts
     WHERE currency <> (SELECT currency FROM ledger_settings WHERE id = 1);
     PRAGMA foreign_key_check;`,
    '--json',
  ])).stdout)
  assert.deepEqual(cleanupVerification[1].results, [{ currency: 'HKD' }])
  assert.deepEqual(cleanupVerification[2].results, [{ accountMismatches: 0 }])
  assert.deepEqual(cleanupVerification[3].results, [])
  return evidence
}

async function recurringTransferNeutralitySnapshot(baseUrl, month) {
  const [summary, transactionSummary, transactionExport, netWorth, payeeSuggestions] = await Promise.all([
    api(baseUrl, `/api/summary?month=${month}`),
    api(baseUrl, `/api/transactions/summary?month=${month}`),
    exportTransactionCsv(baseUrl, { month }),
    api(baseUrl, `/api/reports/net-worth?month=${month}`),
    api(baseUrl, '/api/payee-suggestions'),
  ])
  for (const result of [summary, transactionSummary, transactionExport, netWorth, payeeSuggestions]) {
    assert.equal(result.response.status, 200, JSON.stringify(result.payload))
  }
  const reportSummary = structuredClone(summary.payload.data)
  delete reportSummary.recurringTransferForecast
  return {
    summary: reportSummary,
    transactionSummary: transactionSummary.payload.data,
    transactionExport: transactionExport.payload,
    netWorth: netWorth.payload.data,
    payeeSuggestions: payeeSuggestions.payload.data,
  }
}

async function verifyRecurringTransferRules(baseUrl, today, month) {
  const tomorrow = shiftCalendarDay(today, 1)
  const createAccount = async (body) => {
    const result = await api(baseUrl, '/api/accounts', { method: 'POST', body })
    assert.equal(result.response.status, 201, JSON.stringify(result.payload))
    return result.payload.data
  }
  const source = await createAccount({
    name: 'Scheduled savings source',
    type: 'bank',
    openingBalanceMinor: 120_000,
    openingBalanceOn: today,
  })
  const destination = await createAccount({
    name: 'Scheduled savings destination',
    type: 'bank',
    openingBalanceMinor: 30_000,
    openingBalanceOn: today,
  })
  const delayed = await createAccount({
    name: 'Future opening transfer source',
    type: 'bank',
    openingBalanceMinor: 50_000,
    openingBalanceOn: tomorrow,
  })
  const disabled = await createAccount({
    name: 'Disabled scheduled transfer account',
    type: 'bank',
  })
  const disabledResult = await api(baseUrl, `/api/accounts/${disabled.id}`, {
    method: 'PATCH',
    body: { isActive: false, updatedAt: disabled.updatedAt },
  })
  assert.equal(disabledResult.response.status, 200, JSON.stringify(disabledResult.payload))

  const ruleIds = {
    main: '70000000-0000-4000-8000-000000000001',
    pause: '70000000-0000-4000-8000-000000000002',
    opening: '70000000-0000-4000-8000-000000000003',
    race: '70000000-0000-4000-8000-000000000004',
    cron: '70000000-0000-4000-8000-000000000005',
    deletedForecast: '70000000-0000-4000-8000-000000000012',
    completedForecast: '70000000-0000-4000-8000-000000000013',
    futureForecast: '70000000-0000-4000-8000-000000000014',
  }
  const baseRule = {
    id: ruleIds.main,
    name: 'Automatic emergency savings',
    amountMinor: 15_000,
    currency: 'HKD',
    fromAccountId: source.id,
    toAccountId: destination.id,
    frequency: 'daily',
    scheduleStartsOn: today,
    scheduleEndsOn: today,
    isActive: true,
    note: 'Confirm funds and the actual bank transfer',
  }

  const crossOrigin = await api(baseUrl, '/api/recurring-transfer-rules', {
    method: 'POST',
    origin: 'https://attacker.invalid',
    body: { ...baseRule, id: '70000000-0000-4000-8000-000000000006' },
  })
  assert.equal(crossOrigin.response.status, 403)
  assert.equal(crossOrigin.payload.error.code, 'ORIGIN_FORBIDDEN')

  for (const [body, expectedCode] of [
    [{ ...baseRule, id: '70000000-0000-4000-8000-000000000007', toAccountId: source.id }, 'VALIDATION_ERROR'],
    [{ ...baseRule, id: '70000000-0000-4000-8000-000000000008', fromAccountId: 999_999 }, 'ACCOUNT_INVALID'],
    [{ ...baseRule, id: '70000000-0000-4000-8000-000000000009', toAccountId: disabled.id }, 'ACCOUNT_INVALID'],
    [{ ...baseRule, id: '70000000-0000-4000-8000-000000000010', currency: 'USD' }, 'ACCOUNT_INVALID'],
    [{ ...baseRule, id: '70000000-0000-4000-8000-000000000011', firstOccurrenceOn: tomorrow }, 'VALIDATION_ERROR'],
  ]) {
    const rejected = await api(baseUrl, '/api/recurring-transfer-rules', {
      method: 'POST',
      body,
    })
    assert.equal(rejected.response.status, 400, JSON.stringify(rejected.payload))
    assert.equal(rejected.payload.error.code, expectedCode)
  }

  const created = await api(baseUrl, '/api/recurring-transfer-rules', {
    method: 'POST',
    body: baseRule,
  })
  assert.equal(created.response.status, 201, JSON.stringify(created.payload))
  assert.equal(created.payload.data.scheduleEndsOn, today)
  assert.equal(created.payload.data.nextOccurrenceOn, today)
  assert.equal(created.payload.data.fromAccountName, source.name)
  assert.equal(created.payload.data.toAccountName, destination.name)

  const replayed = await api(baseUrl, '/api/recurring-transfer-rules', {
    method: 'POST',
    body: baseRule,
  })
  assert.equal(replayed.response.status, 200, JSON.stringify(replayed.payload))
  const idConflict = await api(baseUrl, '/api/recurring-transfer-rules', {
    method: 'POST',
    body: { ...baseRule, amountMinor: baseRule.amountMinor + 1 },
  })
  assert.equal(idConflict.response.status, 409)
  assert.equal(idConflict.payload.error.code, 'ID_CONFLICT')

  const [listed, fetched] = await Promise.all([
    api(baseUrl, '/api/recurring-transfer-rules'),
    api(baseUrl, `/api/recurring-transfer-rules/${ruleIds.main}`),
  ])
  assert.equal(listed.response.status, 200)
  assert(listed.payload.data.some(({ id }) => id === ruleIds.main))
  assert.equal(fetched.response.status, 200)
  assert.deepEqual(fetched.payload.data, created.payload.data)

  for (const account of [source, destination]) {
    const guarded = await api(baseUrl, `/api/accounts/${account.id}`, {
      method: 'PATCH',
      body: { isActive: false, updatedAt: account.updatedAt },
    })
    assert.equal(guarded.response.status, 409, JSON.stringify(guarded.payload))
    assert.equal(guarded.payload.error.code, 'REFERENCE_ACTIVE_RULES')
  }

  const incompatibleCachedUpdate = await api(
    baseUrl,
    `/api/recurring-transfer-rules/${ruleIds.main}`,
    {
      method: 'PUT',
      body: {
        name: baseRule.name,
        amountMinor: baseRule.amountMinor,
        currency: baseRule.currency,
        fromAccountId: baseRule.fromAccountId,
        toAccountId: baseRule.toAccountId,
        frequency: baseRule.frequency,
        scheduleStartsOn: tomorrow,
        isActive: true,
        note: baseRule.note,
        revision: created.payload.data.revision,
      },
    },
  )
  assert.equal(incompatibleCachedUpdate.response.status, 409)
  assert.equal(
    incompatibleCachedUpdate.payload.error.code,
    'RECURRING_TRANSFER_RULE_VERSION_CONFLICT',
  )
  const afterRejectedCachedUpdate = await api(
    baseUrl,
    `/api/recurring-transfer-rules/${ruleIds.main}`,
  )
  assert.equal(afterRejectedCachedUpdate.payload.data.revision, created.payload.data.revision)
  assert.equal(afterRejectedCachedUpdate.payload.data.scheduleEndsOn, today)

  const compatibleCachedUpdate = await api(
    baseUrl,
    `/api/recurring-transfer-rules/${ruleIds.main}`,
    {
      method: 'PUT',
      body: {
        name: 'Automatic emergency savings (cached edit)',
        amountMinor: baseRule.amountMinor,
        currency: baseRule.currency,
        fromAccountId: baseRule.fromAccountId,
        toAccountId: baseRule.toAccountId,
        frequency: baseRule.frequency,
        scheduleStartsOn: today,
        isActive: true,
        note: baseRule.note,
        revision: created.payload.data.revision,
      },
    },
  )
  assert.equal(compatibleCachedUpdate.response.status, 200, JSON.stringify(compatibleCachedUpdate.payload))
  assert.equal(compatibleCachedUpdate.payload.data.scheduleEndsOn, today)

  const pauseRuleBody = {
    ...baseRule,
    id: ruleIds.pause,
    name: 'Pause, resume, and skip transfer',
  }
  const pauseRule = await api(baseUrl, '/api/recurring-transfer-rules', {
    method: 'POST',
    body: pauseRuleBody,
  })
  assert.equal(pauseRule.response.status, 201, JSON.stringify(pauseRule.payload))
  const paused = await api(baseUrl, `/api/recurring-transfer-rules/${ruleIds.pause}/status`, {
    method: 'PATCH',
    body: { isActive: false, revision: pauseRule.payload.data.revision },
  })
  assert.equal(paused.response.status, 200, JSON.stringify(paused.payload))

  const deletedForecastRule = await api(baseUrl, '/api/recurring-transfer-rules', {
    method: 'POST',
    body: {
      ...baseRule,
      id: ruleIds.deletedForecast,
      name: 'Deleted forecast transfer',
      scheduleEndsOn: null,
    },
  })
  assert.equal(deletedForecastRule.response.status, 201, JSON.stringify(deletedForecastRule.payload))
  const deletedForecast = await api(
    baseUrl,
    `/api/recurring-transfer-rules/${ruleIds.deletedForecast}`,
    {
      method: 'DELETE',
      body: { revision: deletedForecastRule.payload.data.revision },
    },
  )
  assert.equal(deletedForecast.response.status, 200, JSON.stringify(deletedForecast.payload))

  const completedForecastRule = await api(baseUrl, '/api/recurring-transfer-rules', {
    method: 'POST',
    body: {
      ...baseRule,
      id: ruleIds.completedForecast,
      name: 'Completed forecast transfer',
    },
  })
  assert.equal(completedForecastRule.response.status, 201, JSON.stringify(completedForecastRule.payload))
  const completedForecast = await api(
    baseUrl,
    `/api/recurring-transfer-rules/${ruleIds.completedForecast}/skip`,
    {
      method: 'POST',
      body: {
        revision: completedForecastRule.payload.data.revision,
        nextOccurrenceOn: today,
      },
    },
  )
  assert.equal(completedForecast.response.status, 200, JSON.stringify(completedForecast.payload))
  assert.equal(completedForecast.payload.data.isActive, false)
  assert.equal(completedForecast.payload.data.scheduleEndsOn, today)
  assert.equal(completedForecast.payload.data.nextOccurrenceOn, tomorrow)

  const futureForecastRule = await api(baseUrl, '/api/recurring-transfer-rules', {
    method: 'POST',
    body: {
      ...baseRule,
      id: ruleIds.futureForecast,
      name: 'Future-month forecast transfer',
      scheduleStartsOn: `${shiftCalendarMonth(month, 1)}-01`,
      scheduleEndsOn: null,
    },
  })
  assert.equal(futureForecastRule.response.status, 201, JSON.stringify(futureForecastRule.payload))
  assert.equal(futureForecastRule.payload.data.isActive, true)

  const revisionProbe = await downloadLedgerBackup(baseUrl)
  assert.equal(revisionProbe.response.status, 200, JSON.stringify(revisionProbe.payload))
  const revisionBeforeForecastReads = await api(baseUrl, '/api/backups/ledger', {
    method: 'POST',
    body: { mode: 'preview', backup: revisionProbe.payload },
  })
  assert.equal(
    revisionBeforeForecastReads.response.status,
    200,
    JSON.stringify(revisionBeforeForecastReads.payload),
  )
  const forecastBeforeRun = await api(baseUrl, `/api/summary?month=${month}`)
  const repeatedForecastBeforeRun = await api(baseUrl, `/api/summary?month=${month}`)
  assert.equal(forecastBeforeRun.response.status, 200, JSON.stringify(forecastBeforeRun.payload))
  assert.deepEqual(repeatedForecastBeforeRun.payload, forecastBeforeRun.payload)
  assert.deepEqual(forecastBeforeRun.payload.data.recurringTransferForecast, [{
    recurringTransferRuleId: ruleIds.main,
    name: compatibleCachedUpdate.payload.data.name,
    amountMinor: baseRule.amountMinor,
    fromAccountId: source.id,
    fromAccountName: source.name,
    fromAccountLocalizationKey: source.localizationKey,
    toAccountId: destination.id,
    toAccountName: destination.name,
    toAccountLocalizationKey: destination.localizationKey,
    frequency: baseRule.frequency,
    firstOccurrenceOn: today,
    occurrenceCount: 1,
    occurrenceDates: [today],
  }])
  const revisionAfterForecastReads = await api(baseUrl, '/api/backups/ledger', {
    method: 'POST',
    body: { mode: 'preview', backup: revisionProbe.payload },
  })
  assert.equal(revisionAfterForecastReads.response.status, 200)
  assert.equal(
    revisionAfterForecastReads.payload.data.currentRevision,
    revisionBeforeForecastReads.payload.data.currentRevision,
  )
  assert.equal(
    revisionAfterForecastReads.payload.data.currentDigest,
    revisionBeforeForecastReads.payload.data.currentDigest,
  )

  const removedFutureForecast = await api(
    baseUrl,
    `/api/recurring-transfer-rules/${ruleIds.futureForecast}`,
    {
      method: 'DELETE',
      body: { revision: futureForecastRule.payload.data.revision },
    },
  )
  assert.equal(removedFutureForecast.response.status, 200, JSON.stringify(removedFutureForecast.payload))

  const callerProvenance = await api(baseUrl, '/api/transfers', {
    method: 'POST',
    body: {
      id: '70000000-0000-4000-8000-000000000099',
      amountMinor: 1_000,
      currency: 'HKD',
      fromAccountId: source.id,
      toAccountId: destination.id,
      occurredOn: today,
      fromCleared: false,
      toCleared: false,
      note: '',
      recurringTransferRuleId: ruleIds.main,
      recurringTransferRuleName: baseRule.name,
      recurrenceDueOn: today,
      recurringOccurrenceKey: `${ruleIds.main}:${today}`,
    },
  })
  assert.equal(callerProvenance.response.status, 400)
  assert.equal(callerProvenance.payload.error.code, 'VALIDATION_ERROR')

  const balancesBefore = await api(baseUrl, `/api/accounts/balances?month=${month}`)
  assert.equal(balancesBefore.response.status, 200)
  const sourceBefore = balancesBefore.payload.data.find(({ accountId }) => accountId === source.id)
  const destinationBefore = balancesBefore.payload.data.find(
    ({ accountId }) => accountId === destination.id,
  )
  assert(sourceBefore)
  assert(destinationBefore)
  const neutralityBefore = await recurringTransferNeutralitySnapshot(baseUrl, month)

  const firstRun = await api(baseUrl, '/api/recurring-transfer-rules/run-due', {
    method: 'POST',
    body: { asOf: today },
  })
  assert.equal(firstRun.response.status, 200, JSON.stringify(firstRun.payload))
  assert.equal(firstRun.payload.data.created, 1)
  assert.equal(firstRun.payload.data.blocked, 0)
  assert.equal(firstRun.payload.data.failed, 0)
  const secondRun = await api(baseUrl, '/api/recurring-transfer-rules/run-due', {
    method: 'POST',
    body: { asOf: today },
  })
  assert.equal(secondRun.response.status, 200)
  assert.equal(secondRun.payload.data.created, 0)

  const forecastAfterRun = await api(baseUrl, `/api/summary?month=${month}`)
  assert.equal(forecastAfterRun.response.status, 200, JSON.stringify(forecastAfterRun.payload))
  assert.deepEqual(forecastAfterRun.payload.data.recurringTransferForecast, [])

  const transfersAfterRun = await api(baseUrl, `/api/transfers?month=${month}`)
  assert.equal(transfersAfterRun.response.status, 200)
  const generated = transfersAfterRun.payload.data.find(
    ({ recurringTransferRuleId }) => recurringTransferRuleId === ruleIds.main,
  )
  assert(generated)
  assert.equal(generated.amountMinor, baseRule.amountMinor)
  assert.equal(generated.currency, 'HKD')
  assert.equal(generated.fromAccountId, source.id)
  assert.equal(generated.toAccountId, destination.id)
  assert.equal(generated.occurredOn, today)
  assert.equal(generated.fromCleared, false)
  assert.equal(generated.toCleared, false)
  assert.equal(generated.recurringTransferRuleName, compatibleCachedUpdate.payload.data.name)
  assert.equal(generated.recurrenceDueOn, today)
  assert.equal(generated.recurringOccurrenceKey, `${ruleIds.main}:${today}`)

  const balancesAfter = await api(baseUrl, `/api/accounts/balances?month=${month}`)
  const sourceAfter = balancesAfter.payload.data.find(({ accountId }) => accountId === source.id)
  const destinationAfter = balancesAfter.payload.data.find(
    ({ accountId }) => accountId === destination.id,
  )
  assert(sourceAfter)
  assert(destinationAfter)
  assert.equal(sourceAfter.recordedBalance, sourceBefore.recordedBalance - baseRule.amountMinor)
  assert.equal(destinationAfter.recordedBalance, destinationBefore.recordedBalance + baseRule.amountMinor)
  assert.equal(sourceAfter.clearedBalance, sourceBefore.clearedBalance)
  assert.equal(destinationAfter.clearedBalance, destinationBefore.clearedBalance)
  assert.equal(sourceAfter.unclearedCount, sourceBefore.unclearedCount + 1)
  assert.equal(destinationAfter.unclearedCount, destinationBefore.unclearedCount + 1)
  assert.equal(
    sourceAfter.recordedBalance + destinationAfter.recordedBalance,
    sourceBefore.recordedBalance + destinationBefore.recordedBalance,
  )

  for (const [account, direction, amountMinor] of [
    [source, 'out', -baseRule.amountMinor],
    [destination, 'in', baseRule.amountMinor],
  ]) {
    const register = await api(
      baseUrl,
      `/api/accounts/register?month=${month}&accountId=${account.id}`,
    )
    assert.equal(register.response.status, 200, JSON.stringify(register.payload))
    const entry = register.payload.data.entries.find(({ sourceId }) => sourceId === generated.id)
    assert(entry)
    assert.equal(entry.kind, 'transfer')
    assert.equal(entry.transferDirection, direction)
    assert.equal(entry.amountMinor, amountMinor)
    assert.equal(entry.cleared, false)
  }

  const neutralityAfterGeneration = await recurringTransferNeutralitySnapshot(baseUrl, month)
  assert.deepEqual(neutralityAfterGeneration, neutralityBefore)
  const completed = await api(baseUrl, `/api/recurring-transfer-rules/${ruleIds.main}`)
  assert.equal(completed.response.status, 200)
  assert.equal(completed.payload.data.isActive, false)
  assert.equal(completed.payload.data.nextOccurrenceOn, tomorrow)
  assert.equal(completed.payload.data.lastOccurrenceOn, today)
  assert.equal(completed.payload.data.generatedCount, 1)

  const rejectedProvenanceEdit = await api(baseUrl, `/api/transfers/${generated.id}`, {
    method: 'PUT',
    body: {
      amountMinor: 17_000,
      currency: 'HKD',
      fromAccountId: destination.id,
      toAccountId: source.id,
      occurredOn: tomorrow,
      fromCleared: true,
      toCleared: true,
      note: 'User reconciled and materially edited this transfer',
      updatedAt: generated.updatedAt,
      recurringTransferRuleId: ruleIds.main,
    },
  })
  assert.equal(rejectedProvenanceEdit.response.status, 400)
  assert.equal(rejectedProvenanceEdit.payload.error.code, 'VALIDATION_ERROR')
  const editedTransfer = await api(baseUrl, `/api/transfers/${generated.id}`, {
    method: 'PUT',
    body: {
      amountMinor: 17_000,
      currency: 'HKD',
      fromAccountId: destination.id,
      toAccountId: source.id,
      occurredOn: tomorrow,
      fromCleared: true,
      toCleared: true,
      note: 'User reconciled and materially edited this transfer',
      updatedAt: generated.updatedAt,
    },
  })
  assert.equal(editedTransfer.response.status, 200, JSON.stringify(editedTransfer.payload))
  assert.equal(editedTransfer.payload.data.recurringTransferRuleId, ruleIds.main)
  assert.equal(editedTransfer.payload.data.recurringTransferRuleName, generated.recurringTransferRuleName)
  assert.equal(editedTransfer.payload.data.recurrenceDueOn, today)
  assert.equal(editedTransfer.payload.data.recurringOccurrenceKey, `${ruleIds.main}:${today}`)

  const editedRule = await api(baseUrl, `/api/recurring-transfer-rules/${ruleIds.main}`, {
    method: 'PUT',
    body: {
      name: 'Future savings plan changed after history',
      amountMinor: 22_000,
      currency: 'HKD',
      fromAccountId: destination.id,
      toAccountId: source.id,
      frequency: 'weekly',
      scheduleStartsOn: today,
      scheduleEndsOn: today,
      isActive: true,
      note: 'Current rule no longer matches its historical transfer',
      revision: completed.payload.data.revision,
    },
  })
  assert.equal(editedRule.response.status, 200, JSON.stringify(editedRule.payload))
  assert.equal(editedRule.payload.data.isActive, false)
  assert.equal(editedRule.payload.data.name, 'Future savings plan changed after history')
  const deletedRule = await api(baseUrl, `/api/recurring-transfer-rules/${ruleIds.main}`, {
    method: 'DELETE',
    body: { revision: editedRule.payload.data.revision },
  })
  assert.equal(deletedRule.response.status, 200)
  const missingDeletedRule = await api(
    baseUrl,
    `/api/recurring-transfer-rules/${ruleIds.main}`,
  )
  assert.equal(missingDeletedRule.response.status, 404)
  assert.equal(missingDeletedRule.payload.error.code, 'RECURRING_TRANSFER_RULE_NOT_FOUND')
  const historicalTransfer = await api(baseUrl, `/api/transfers/${generated.id}`)
  assert.equal(historicalTransfer.response.status, 200)
  assert.equal(historicalTransfer.payload.data.recurringTransferRuleName, generated.recurringTransferRuleName)
  assert.equal(historicalTransfer.payload.data.recurrenceDueOn, today)

  const stalePause = await api(baseUrl, `/api/recurring-transfer-rules/${ruleIds.pause}/status`, {
    method: 'PATCH',
    body: { isActive: true, revision: pauseRule.payload.data.revision },
  })
  assert.equal(stalePause.response.status, 409)
  const resumed = await api(baseUrl, `/api/recurring-transfer-rules/${ruleIds.pause}/status`, {
    method: 'PATCH',
    body: { isActive: true, revision: paused.payload.data.revision },
  })
  assert.equal(resumed.response.status, 200)
  const skipped = await api(baseUrl, `/api/recurring-transfer-rules/${ruleIds.pause}/skip`, {
    method: 'POST',
    body: { revision: resumed.payload.data.revision, nextOccurrenceOn: today },
  })
  assert.equal(skipped.response.status, 200)
  assert.equal(skipped.payload.data.nextOccurrenceOn, tomorrow)
  assert.equal(skipped.payload.data.isActive, false)
  assert.equal(skipped.payload.data.generatedCount, 0)

  const openingRule = await api(baseUrl, '/api/recurring-transfer-rules', {
    method: 'POST',
    body: {
      ...baseRule,
      id: ruleIds.opening,
      name: 'Opening boundary transfer',
      fromAccountId: delayed.id,
      toAccountId: source.id,
    },
  })
  assert.equal(openingRule.response.status, 201, JSON.stringify(openingRule.payload))
  const blockedOpeningRun = await api(baseUrl, '/api/recurring-transfer-rules/run-due', {
    method: 'POST',
    body: { asOf: today },
  })
  assert.equal(blockedOpeningRun.response.status, 200)
  assert.equal(blockedOpeningRun.payload.data.created, 0)
  assert.equal(blockedOpeningRun.payload.data.blocked, 1)
  const blockedOpeningRule = await api(
    baseUrl,
    `/api/recurring-transfer-rules/${ruleIds.opening}`,
  )
  assert.equal(blockedOpeningRule.payload.data.lastErrorCode, 'ACCOUNT_OPENING_DATE_AFTER_DUE')
  assert.equal(blockedOpeningRule.payload.data.nextOccurrenceOn, today)
  assert.equal(blockedOpeningRule.payload.data.generatedCount, 0)
  assert.equal(
    (await api(baseUrl, `/api/transfers?month=${month}`)).payload.data.some(
      ({ recurringTransferRuleId }) => recurringTransferRuleId === ruleIds.opening,
    ),
    false,
  )
  const skippedOpening = await api(baseUrl, `/api/recurring-transfer-rules/${ruleIds.opening}/skip`, {
    method: 'POST',
    body: { revision: blockedOpeningRule.payload.data.revision, nextOccurrenceOn: today },
  })
  assert.equal(skippedOpening.response.status, 200)
  assert.equal(skippedOpening.payload.data.isActive, false)

  const raceRule = await api(baseUrl, '/api/recurring-transfer-rules', {
    method: 'POST',
    body: { ...baseRule, id: ruleIds.race, name: 'Concurrent transfer run' },
  })
  assert.equal(raceRule.response.status, 201)
  const concurrentRuns = await Promise.all([
    api(baseUrl, '/api/recurring-transfer-rules/run-due', { method: 'POST', body: { asOf: today } }),
    api(baseUrl, '/api/recurring-transfer-rules/run-due', { method: 'POST', body: { asOf: today } }),
  ])
  assert(concurrentRuns.every(({ response }) => response.status === 200))
  assert.equal(
    concurrentRuns.reduce((total, result) => total + result.payload.data.created, 0),
    1,
  )
  const raceTransfers = (await api(baseUrl, `/api/transfers?month=${month}`)).payload.data.filter(
    ({ recurringTransferRuleId }) => recurringTransferRuleId === ruleIds.race,
  )
  assert.equal(raceTransfers.length, 1)

  const cronRule = await api(baseUrl, '/api/recurring-transfer-rules', {
    method: 'POST',
    body: { ...baseRule, id: ruleIds.cron, name: 'Scheduled worker transfer' },
  })
  assert.equal(cronRule.response.status, 201)
  const scheduled = await fetch(`${baseUrl}/__scheduled?cron=5+16+*+*+*`)
  assert.equal(scheduled.status, 200)
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
  const cronTransfers = (await api(baseUrl, `/api/transfers?month=${month}`)).payload.data.filter(
    ({ recurringTransferRuleId }) => recurringTransferRuleId === ruleIds.cron,
  )
  assert.equal(cronTransfers.length, 1)
  const repeatedScheduled = await fetch(`${baseUrl}/__scheduled?cron=5+16+*+*+*`)
  assert.equal(repeatedScheduled.status, 200)
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
  assert.equal(
    (await api(baseUrl, `/api/transfers?month=${month}`)).payload.data.filter(
      ({ recurringTransferRuleId }) => recurringTransferRuleId === ruleIds.cron,
    ).length,
    1,
  )

  const neutralityAfterAll = await recurringTransferNeutralitySnapshot(baseUrl, month)
  assert.deepEqual(neutralityAfterAll, neutralityBefore)
  for (const account of [source, destination]) {
    const released = await api(baseUrl, `/api/accounts/${account.id}`, {
      method: 'PATCH',
      body: { isActive: false, updatedAt: account.updatedAt },
    })
    assert.equal(released.response.status, 200, JSON.stringify(released.payload))
  }

  return {
    ruleIds,
    generatedTransferIds: [generated.id, raceTransfers[0].id, cronTransfers[0].id],
    historicalTransfer: historicalTransfer.payload.data,
    evidence: {
      recurringTransferRuleLifecycles: 5,
      recurringTransferRuleGuards: 13,
      recurringTransferRuns: 8,
      recurringTransferOccurrences: 3,
      recurringTransferAccountingChecks: 8,
      recurringTransferReportNeutralityChecks: 5,
      recurringTransferForecastEligibilityChecks: 6,
      recurringTransferForecastNoWriteChecks: 2,
      recurringTransferReferenceReleases: 2,
      recurringTransferOpeningDateBlocks: 1,
      recurringTransferCronRuns: 2,
    },
  }
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
  const ledgerSettings = await api(baseUrl, '/api/ledger-settings')
  assert.equal(accountsResult.response.status, 200)
  assert.equal(categoriesResult.response.status, 200)
  assert.equal(ledgerSettings.response.status, 200, JSON.stringify(ledgerSettings.payload))
  assert.equal(ledgerSettings.payload.data.currency, 'HKD')
  assert.equal(ledgerSettings.payload.data.canChangeCurrency, false)
  const lockedCurrencyChange = await api(baseUrl, '/api/ledger-settings', {
    method: 'PUT',
    body: { currency: 'USD', expectedUpdatedAt: ledgerSettings.payload.data.updatedAt },
  })
  assert.equal(lockedCurrencyChange.response.status, 409)
  assert.equal(lockedCurrencyChange.payload.error.code, 'LEDGER_CURRENCY_LOCKED')
  assert.match(accountsResult.response.headers.get('cache-control') ?? '', /no-store/)
  assert(accountsResult.payload.data.every(({ updatedAt }) => typeof updatedAt === 'string' && updatedAt.endsWith('Z')))
  assert(accountsResult.payload.data.every(({ openingBalanceMinor, openingBalanceOn }) => (
    openingBalanceMinor === null && openingBalanceOn === null
  )))
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
  assert.equal(categorySummary.payload.data.income, 91_615)
  assert.equal(categorySummary.payload.data.expense, 41_615)
  assert.equal(categorySummary.payload.data.balance, 50_000)
  assert.deepEqual(categorySummary.payload.data.incomeByCategory, [
    {
      categoryId: 2,
      categoryName: '其他收入',
      categoryLocalizationKey: 'category.other_income',
      categoryIcon: 'circle-dollar-sign',
      categoryColor: '#5B7C6F',
      amountMinor: 50_000,
      transactionCount: 1,
    },
    {
      categoryId: 1,
      categoryName: '薪資',
      categoryLocalizationKey: 'category.salary',
      categoryIcon: 'banknote',
      categoryColor: '#2F766D',
      amountMinor: 41_615,
      transactionCount: 205,
    },
  ])
  const cappedIncomeRows = await api(
    baseUrl,
    `/api/transactions?month=${month}&type=income&categoryId=1`,
  )
  assert.equal(cappedIncomeRows.response.status, 200)
  assert.equal(cappedIncomeRows.payload.data.length, 200)
  const salaryCategory = categoriesResult.payload.data.find(({ id }) => id === 1)
  assert(salaryCategory)
  const disabledSalaryCategory = await api(baseUrl, '/api/categories/1', {
    method: 'PATCH',
    body: { isActive: false, updatedAt: salaryCategory.updatedAt },
  })
  assert.equal(disabledSalaryCategory.response.status, 200)
  const inactiveIncomeSummary = await api(baseUrl, `/api/summary?month=${month}`)
  assert.deepEqual(
    inactiveIncomeSummary.payload.data.incomeByCategory,
    categorySummary.payload.data.incomeByCategory,
  )
  const reenabledSalaryCategory = await api(baseUrl, '/api/categories/1', {
    method: 'PATCH',
    body: { isActive: true, updatedAt: disabledSalaryCategory.payload.data.updatedAt },
  })
  assert.equal(reenabledSalaryCategory.response.status, 200)
  Object.assign(salaryCategory, reenabledSalaryCategory.payload.data)
  assert.deepEqual(categorySummary.payload.data.expenseByCategory, [{
    categoryId: 3,
    categoryName: '餐飲',
    categoryLocalizationKey: 'category.food',
    categoryIcon: 'utensils',
    categoryColor: '#C16B4B',
    amountMinor: 41_615,
    transactionCount: 205,
    previousMonthAmountMinor: 12_345,
  }])
  assert.deepEqual(categorySummary.payload.data.expenseByPayee, [{
    payee: 'export bulk',
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
  const plannedCategory = categoriesResult.payload.data.find(({ id }) => id === 3)
  assert(plannedCategory)
  const disabledPlannedCategory = await api(baseUrl, '/api/categories/3', {
    method: 'PATCH',
    body: { isActive: false, updatedAt: plannedCategory.updatedAt },
  })
  assert.equal(disabledPlannedCategory.response.status, 200)
  const inactivePlanSummary = await api(baseUrl, `/api/summary?month=${month}`)
  assert.deepEqual(inactivePlanSummary.payload.data.monthlySpendingPlans, [{
    categoryId: 3,
    categoryName: '餐飲',
    categoryLocalizationKey: 'category.food',
    categoryIcon: 'utensils',
    categoryColor: '#C16B4B',
    plannedMinor: 50_000,
    spentMinor: 41_615,
  }])
  const reenabledPlannedCategory = await api(baseUrl, '/api/categories/3', {
    method: 'PATCH',
    body: {
      isActive: true,
      updatedAt: disabledPlannedCategory.payload.data.updatedAt,
    },
  })
  assert.equal(reenabledPlannedCategory.response.status, 200)
  assert.equal(categorySummary.payload.data.cashFlowTrend.length, 6)
  assert.deepEqual(categorySummary.payload.data.cashFlowTrend.slice(-2), [
    {
      month: previousMonth,
      incomeMinor: 0,
      expenseMinor: 12_345,
      netMinor: -12_345,
      transactionCount: 1,
    },
    {
      month,
      incomeMinor: 91_615,
      expenseMinor: 41_615,
      netMinor: 50_000,
      transactionCount: 411,
    },
  ])
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
    body: {
      name: 'Integration savings',
      type: 'bank',
      openingBalanceMinor: 100_000,
      openingBalanceOn: today,
    },
  })
  assert.equal(createdAccount.response.status, 201)
  assert.equal(createdAccount.payload.data.localizationKey, null)
  assert.equal(createdAccount.payload.data.isActive, true)
  assert.equal(createdAccount.payload.data.openingBalanceMinor, 100_000)
  assert.equal(createdAccount.payload.data.openingBalanceOn, today)

  const nextMonthStart = `${shiftCalendarMonth(month, 1)}-01`
  const futureOpeningAccount = await api(baseUrl, `/api/accounts/${createdAccount.payload.data.id}`, {
    method: 'PUT',
    body: {
      name: createdAccount.payload.data.name,
      type: createdAccount.payload.data.type,
      openingBalanceMinor: createdAccount.payload.data.openingBalanceMinor,
      openingBalanceOn: nextMonthStart,
      updatedAt: createdAccount.payload.data.updatedAt,
    },
  })
  assert.equal(futureOpeningAccount.response.status, 200)
  const balancesBeforeExactOpening = await api(baseUrl, `/api/accounts/balances?month=${month}`)
  const balanceBeforeExactOpening = balancesBeforeExactOpening.payload.data.find(
    ({ accountId }) => accountId === createdAccount.payload.data.id,
  )
  assert(balanceBeforeExactOpening)
  assert.equal(balanceBeforeExactOpening.recordedBalance, null)
  assert.equal(balanceBeforeExactOpening.clearedBalance, null)
  assert.equal(balanceBeforeExactOpening.unclearedBalance, null)
  assert.equal(balanceBeforeExactOpening.unclearedCount, null)
  const restoredOpeningAccount = await api(baseUrl, `/api/accounts/${createdAccount.payload.data.id}`, {
    method: 'PUT',
    body: {
      name: createdAccount.payload.data.name,
      type: createdAccount.payload.data.type,
      openingBalanceMinor: createdAccount.payload.data.openingBalanceMinor,
      openingBalanceOn: today,
      updatedAt: futureOpeningAccount.payload.data.updatedAt,
    },
  })
  assert.equal(restoredOpeningAccount.response.status, 200)

  const incompleteOpeningBalance = await api(baseUrl, '/api/accounts', {
    method: 'POST',
    body: { name: 'Invalid opening', type: 'bank', openingBalanceMinor: 100_000 },
  })
  assert.equal(incompleteOpeningBalance.response.status, 400)
  assert.equal(incompleteOpeningBalance.payload.error.code, 'VALIDATION_ERROR')

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
      openingBalanceMinor: createdAccount.payload.data.openingBalanceMinor,
      openingBalanceOn: createdAccount.payload.data.openingBalanceOn,
      updatedAt: restoredOpeningAccount.payload.data.updatedAt,
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
      openingBalanceMinor: createdAccount.payload.data.openingBalanceMinor,
      openingBalanceOn: createdAccount.payload.data.openingBalanceOn,
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

  const initialEmergencyFundGoal = await api(baseUrl, '/api/emergency-fund-goal')
  assert.equal(initialEmergencyFundGoal.response.status, 200)
  assert.match(initialEmergencyFundGoal.response.headers.get('cache-control') ?? '', /no-store/)
  assert.equal(initialEmergencyFundGoal.payload.data, null)

  const crossOriginEmergencyFundGoal = await api(baseUrl, '/api/emergency-fund-goal', {
    method: 'PUT',
    origin: 'https://attacker.invalid',
    body: {
      accountId: createdAccount.payload.data.id,
      targetMinor: 500_000,
      expectedUpdatedAt: null,
    },
  })
  assert.equal(crossOriginEmergencyFundGoal.response.status, 403)
  assert.equal(crossOriginEmergencyFundGoal.payload.error.code, 'ORIGIN_FORBIDDEN')

  const inactiveEmergencyFundGoal = await api(baseUrl, '/api/emergency-fund-goal', {
    method: 'PUT',
    body: {
      accountId: createdAccount.payload.data.id,
      targetMinor: 500_000,
      expectedUpdatedAt: null,
    },
  })
  assert.equal(inactiveEmergencyFundGoal.response.status, 400)
  assert.equal(inactiveEmergencyFundGoal.payload.error.code, 'EMERGENCY_FUND_ACCOUNT_INVALID')

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

  const missingEmergencyFundGoal = await api(baseUrl, '/api/emergency-fund-goal', {
    method: 'PUT',
    body: { accountId: 999_999, targetMinor: 500_000, expectedUpdatedAt: null },
  })
  assert.equal(missingEmergencyFundGoal.response.status, 400)
  assert.equal(missingEmergencyFundGoal.payload.error.code, 'EMERGENCY_FUND_ACCOUNT_INVALID')

  const creditCardAccount = accountsResult.payload.data.find(({ type }) => type === 'credit_card')
  assert(creditCardAccount)
  const emergencyFundBackupAccount = accountsResult.payload.data.find(
    ({ id, type }) => id !== createdAccount.payload.data.id && type !== 'credit_card',
  )
  assert(emergencyFundBackupAccount)
  const creditEmergencyFundGoal = await api(baseUrl, '/api/emergency-fund-goal', {
    method: 'PUT',
    body: {
      accountId: creditCardAccount.id,
      targetMinor: 500_000,
      expectedUpdatedAt: null,
    },
  })
  assert.equal(creditEmergencyFundGoal.response.status, 400)
  assert.equal(creditEmergencyFundGoal.payload.error.code, 'EMERGENCY_FUND_ACCOUNT_INVALID')

  const createdEmergencyFundGoal = await api(baseUrl, '/api/emergency-fund-goal', {
    method: 'PUT',
    body: {
      accountId: createdAccount.payload.data.id,
      targetMinor: 500_000,
      expectedUpdatedAt: null,
    },
  })
  assert.equal(createdEmergencyFundGoal.response.status, 201)
  assert.equal(createdEmergencyFundGoal.payload.data.accountId, createdAccount.payload.data.id)
  assert.equal(createdEmergencyFundGoal.payload.data.targetMinor, 500_000)
  assert.match(createdEmergencyFundGoal.payload.data.createdAt, /Z$/)
  assert.match(createdEmergencyFundGoal.payload.data.updatedAt, /Z$/)

  const conflictingEmergencyFundCreate = await api(baseUrl, '/api/emergency-fund-goal', {
    method: 'PUT',
    body: {
      accountId: createdAccount.payload.data.id,
      targetMinor: 600_000,
      expectedUpdatedAt: null,
    },
  })
  assert.equal(conflictingEmergencyFundCreate.response.status, 409)
  assert.equal(conflictingEmergencyFundCreate.payload.error.code, 'EMERGENCY_FUND_GOAL_VERSION_CONFLICT')

  const updatedEmergencyFundGoal = await api(baseUrl, '/api/emergency-fund-goal', {
    method: 'PUT',
    body: {
      accountId: createdAccount.payload.data.id,
      targetMinor: 750_000,
      expectedUpdatedAt: createdEmergencyFundGoal.payload.data.updatedAt,
    },
  })
  assert.equal(updatedEmergencyFundGoal.response.status, 200)
  assert.equal(updatedEmergencyFundGoal.payload.data.targetMinor, 750_000)
  assert.notEqual(
    updatedEmergencyFundGoal.payload.data.updatedAt,
    createdEmergencyFundGoal.payload.data.updatedAt,
  )

  const staleEmergencyFundUpdate = await api(baseUrl, '/api/emergency-fund-goal', {
    method: 'PUT',
    body: {
      accountId: createdAccount.payload.data.id,
      targetMinor: 800_000,
      expectedUpdatedAt: createdEmergencyFundGoal.payload.data.updatedAt,
    },
  })
  assert.equal(staleEmergencyFundUpdate.response.status, 409)
  assert.equal(staleEmergencyFundUpdate.payload.error.code, 'EMERGENCY_FUND_GOAL_VERSION_CONFLICT')
  const goalAfterStaleUpdate = await api(baseUrl, '/api/emergency-fund-goal')
  assert.equal(goalAfterStaleUpdate.payload.data.targetMinor, 750_000)

  const guardedGoalAccountDisable = await api(
    baseUrl,
    `/api/accounts/${createdAccount.payload.data.id}`,
    {
      method: 'PATCH',
      body: { isActive: false, updatedAt: enabledAccount.payload.data.updatedAt },
    },
  )
  assert.equal(guardedGoalAccountDisable.response.status, 409)
  assert.equal(guardedGoalAccountDisable.payload.error.code, 'REFERENCE_EMERGENCY_FUND_GOAL')

  const guardedGoalAccountType = await api(
    baseUrl,
    `/api/accounts/${createdAccount.payload.data.id}`,
    {
      method: 'PUT',
      body: {
        name: enabledAccount.payload.data.name,
        type: 'credit_card',
        openingBalanceMinor: enabledAccount.payload.data.openingBalanceMinor,
        openingBalanceOn: enabledAccount.payload.data.openingBalanceOn,
        updatedAt: enabledAccount.payload.data.updatedAt,
      },
    },
  )
  assert.equal(guardedGoalAccountType.response.status, 409)
  assert.equal(guardedGoalAccountType.payload.error.code, 'REFERENCE_EMERGENCY_FUND_GOAL')
  const goalAccountAfterGuards = await api(
    baseUrl,
    `/api/accounts/${createdAccount.payload.data.id}`,
  )
  assert.equal(goalAccountAfterGuards.payload.data.isActive, true)
  assert.equal(goalAccountAfterGuards.payload.data.type, 'wallet')
  assert.equal(goalAccountAfterGuards.payload.data.updatedAt, enabledAccount.payload.data.updatedAt)

  const staleEmergencyFundDelete = await api(baseUrl, '/api/emergency-fund-goal', {
    method: 'DELETE',
    body: { expectedUpdatedAt: createdEmergencyFundGoal.payload.data.updatedAt },
  })
  assert.equal(staleEmergencyFundDelete.response.status, 409)
  assert.equal(staleEmergencyFundDelete.payload.error.code, 'EMERGENCY_FUND_GOAL_VERSION_CONFLICT')

  const deletedEmergencyFundGoal = await api(baseUrl, '/api/emergency-fund-goal', {
    method: 'DELETE',
    body: { expectedUpdatedAt: updatedEmergencyFundGoal.payload.data.updatedAt },
  })
  assert.equal(deletedEmergencyFundGoal.response.status, 200)
  assert.deepEqual(deletedEmergencyFundGoal.payload.data, { deleted: true })
  const missingEmergencyFundDelete = await api(baseUrl, '/api/emergency-fund-goal', {
    method: 'DELETE',
    body: { expectedUpdatedAt: updatedEmergencyFundGoal.payload.data.updatedAt },
  })
  assert.equal(missingEmergencyFundDelete.response.status, 404)
  assert.equal(missingEmergencyFundDelete.payload.error.code, 'EMERGENCY_FUND_GOAL_NOT_FOUND')
  assert.equal((await api(baseUrl, '/api/emergency-fund-goal')).payload.data, null)

  const releasedGoalAccount = await api(
    baseUrl,
    `/api/accounts/${createdAccount.payload.data.id}`,
    {
      method: 'PATCH',
      body: { isActive: false, updatedAt: goalAccountAfterGuards.payload.data.updatedAt },
    },
  )
  assert.equal(releasedGoalAccount.response.status, 200)
  assert.equal(releasedGoalAccount.payload.data.isActive, false)
  const restoredGoalAccount = await api(
    baseUrl,
    `/api/accounts/${createdAccount.payload.data.id}`,
    {
      method: 'PATCH',
      body: { isActive: true, updatedAt: releasedGoalAccount.payload.data.updatedAt },
    },
  )
  assert.equal(restoredGoalAccount.response.status, 200)
  assert.equal(restoredGoalAccount.payload.data.isActive, true)

  const emergencyFundGoal = await api(baseUrl, '/api/emergency-fund-goal', {
    method: 'PUT',
    body: {
      accountId: emergencyFundBackupAccount.id,
      targetMinor: 900_000,
      expectedUpdatedAt: null,
    },
  })
  assert.equal(emergencyFundGoal.response.status, 201)

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
  const incomeCategory = categoriesAfterOrder.payload.data
    .find(({ isActive, type }) => isActive && type === 'income')
  const transferDestination = reorderedAccounts.payload.data.find(({ id, isActive, currency }) => (
    id !== account?.id && isActive && currency === 'HKD'
  ))
  const unrelatedTransferAccount = reorderedAccounts.payload.data.find(({ id, isActive, currency }) => (
    id !== account?.id && id !== transferDestination?.id && isActive && currency === 'HKD'
  ))
  assert(account)
  assert(expenseCategory)
  assert(incomeCategory)
  assert(transferDestination)
  assert(unrelatedTransferAccount)
  const csvCorrectionCategory = categoriesAfterOrder.payload.data.find(({ id, isActive, type }) => (
    id !== expenseCategory.id && isActive && type === 'expense'
  ))
  assert(csvCorrectionCategory)

  const oversizedPayee = 'Oversized aggregate QA'
  const oversizedTransactionBodies = [
    {
      id: '59000000-0000-4000-8000-000000000001',
      amountMinor: Number.MAX_SAFE_INTEGER,
    },
    {
      id: '59000000-0000-4000-8000-000000000002',
      amountMinor: 2,
    },
  ].map(({ id, amountMinor }) => ({
    id,
    type: 'income',
    amountMinor,
    currency: account.currency,
    accountId: account.id,
    categoryId: incomeCategory.id,
    occurredOn: today,
    cleared: false,
    payee: oversizedPayee,
    note: '',
  }))
  const oversizedTransactions = await Promise.all(oversizedTransactionBodies.map((body) => (
    api(baseUrl, '/api/transactions', { method: 'POST', body })
  )))
  assert(oversizedTransactions.every(({ response }) => response.status === 201))
  assert(oversizedTransactions.every(({ payload }) => (
    typeof payload.data.updatedAt === 'string'
  )))

  const encodedOversizedPayee = encodeURIComponent(oversizedPayee)
  const oversizedSummaries = await Promise.all([
    api(baseUrl, `/api/summary?month=${month}`),
    api(
      baseUrl,
      `/api/transactions/summary?month=${month}&search=${encodedOversizedPayee}`,
    ),
    api(
      baseUrl,
      `/api/transactions/summary?month=${month}&payee=${encodedOversizedPayee}`,
    ),
  ])
  for (const result of oversizedSummaries) {
    assert.equal(result.response.status, 500, JSON.stringify(result.payload))
    assert.equal(result.payload.ok, false)
    assert.equal(result.payload.error.code, 'INTERNAL_ERROR')
    assert.equal(result.payload.data, undefined)
  }

  const deletedOversizedTransactions = await Promise.all(oversizedTransactions.map(
    ({ payload }, index) => api(
      baseUrl,
      `/api/transactions/${oversizedTransactionBodies[index].id}`,
      { method: 'DELETE', body: { updatedAt: payload.data.updatedAt } },
    ),
  ))
  assert(deletedOversizedTransactions.every(({ response }) => response.status === 200))
  assert(deletedOversizedTransactions.every(({ payload }, index) => (
    payload.data.id === oversizedTransactionBodies[index].id
      && payload.data.deleted === true
  )))

  const recoveredSummaries = await Promise.all([
    api(baseUrl, `/api/summary?month=${month}`),
    api(
      baseUrl,
      `/api/transactions/summary?month=${month}&search=${encodedOversizedPayee}`,
    ),
    api(
      baseUrl,
      `/api/transactions/summary?month=${month}&payee=${encodedOversizedPayee}`,
    ),
  ])
  assert.equal(recoveredSummaries[0].response.status, 200)
  for (const result of recoveredSummaries.slice(1)) {
    assert.equal(result.response.status, 200)
    assert.deepEqual(result.payload.data, {
      transactionCount: 0,
      income: 0,
      expense: 0,
      net: 0,
    })
  }

  const invalidTransferAccountFilter = await api(
    baseUrl,
    `/api/transfers?month=${month}&accountId=0`,
  )
  assert.equal(invalidTransferAccountFilter.response.status, 400)
  assert.equal(invalidTransferAccountFilter.payload.error.code, 'INVALID_QUERY')
  const duplicateTransferAccountFilter = await api(
    baseUrl,
    `/api/transfers?month=${month}&accountId=${account.id}&accountId=${account.id}`,
  )
  assert.equal(duplicateTransferAccountFilter.response.status, 400)

  const invalidBalanceMonth = await api(baseUrl, '/api/accounts/balances?month=2026-13')
  assert.equal(invalidBalanceMonth.response.status, 400)
  assert.equal(invalidBalanceMonth.payload.error.code, 'INVALID_QUERY')
  const duplicateBalanceMonth = await api(
    baseUrl,
    `/api/accounts/balances?month=${month}&month=${month}`,
  )
  assert.equal(duplicateBalanceMonth.response.status, 400)
  const invalidRegisterAccount = await api(
    baseUrl,
    `/api/accounts/register?month=${month}&accountId=0`,
  )
  assert.equal(invalidRegisterAccount.response.status, 400)
  assert.equal(invalidRegisterAccount.payload.error.code, 'INVALID_QUERY')
  const duplicateRegisterAccount = await api(
    baseUrl,
    `/api/accounts/register?month=${month}&accountId=${account.id}&accountId=${account.id}`,
  )
  assert.equal(duplicateRegisterAccount.response.status, 400)
  const missingRegisterAccount = await api(
    baseUrl,
    `/api/accounts/register?month=${month}&accountId=999999`,
  )
  assert.equal(missingRegisterAccount.response.status, 404)
  assert.equal(missingRegisterAccount.payload.error.code, 'ACCOUNT_NOT_FOUND')
  const rejectedRegisterWrite = await api(
    baseUrl,
    `/api/accounts/register?month=${month}&accountId=${account.id}`,
    { method: 'POST', body: {} },
  )
  assert.equal(rejectedRegisterWrite.response.status, 404)
  const balancesBeforeTransfer = await api(baseUrl, `/api/accounts/balances?month=${month}`)
  assert.equal(balancesBeforeTransfer.response.status, 200, JSON.stringify(balancesBeforeTransfer.payload))
  const bulkAccountBalance = balancesBeforeTransfer.payload.data.find(({ accountId }) => accountId === 1)
  assert(bulkAccountBalance)
  const cappedRegister = await api(
    baseUrl,
    `/api/accounts/register?month=${month}&accountId=1`,
  )
  assert.equal(cappedRegister.response.status, 200, JSON.stringify(cappedRegister.payload))
  assert.equal(cappedRegister.payload.data.entryCount, 411)
  assert.equal(cappedRegister.payload.data.entries.length, 200)
  assert.equal(cappedRegister.payload.data.dateFrom, `${month}-01`)
  assert.equal(
    cappedRegister.payload.data.dateTo,
    shiftCalendarDay(`${shiftCalendarMonth(month, 1)}-01`, -1),
  )
  assert.equal(cappedRegister.payload.data.endingBalanceMinor, bulkAccountBalance.recordedBalance)
  assert.equal(
    cappedRegister.payload.data.clearedEndingBalanceMinor,
    bulkAccountBalance.clearedBalance,
  )
  assert.equal(
    cappedRegister.payload.data.unclearedEndingBalanceMinor,
    bulkAccountBalance.unclearedBalance,
  )
  assert.equal(cappedRegister.payload.data.unclearedCount, bulkAccountBalance.unclearedCount)
  assert.equal(
    cappedRegister.payload.data.entries[0].runningBalanceMinor,
    bulkAccountBalance.recordedBalance,
  )
  const accountRegisterExportBody = { month, accountId: 1 }
  const oldestBulkTransactionId = '30000000-0000-4000-8000-000000000001'
  assert.equal(
    cappedRegister.payload.data.entries.some(({ sourceId }) => sourceId === oldestBulkTransactionId),
    false,
  )
  const cappedAccountRegisterExport = await exportAccountRegisterCsv(
    baseUrl,
    accountRegisterExportBody,
  )
  assert.equal(
    cappedAccountRegisterExport.response.status,
    200,
    JSON.stringify(cappedAccountRegisterExport.payload),
  )
  assert.equal(
    cappedAccountRegisterExport.response.url,
    `${baseUrl}/api/exports/account-register`,
  )
  assert.match(
    cappedAccountRegisterExport.response.headers.get('content-type') ?? '',
    /^text\/csv;\s*charset=utf-8/i,
  )
  assert.match(
    cappedAccountRegisterExport.response.headers.get('cache-control') ?? '',
    /private.*no-store/,
  )
  assert.equal(
    cappedAccountRegisterExport.response.headers.get('x-content-type-options'),
    'nosniff',
  )
  assert.equal(
    cappedAccountRegisterExport.response.headers.get('content-disposition'),
    `attachment; filename="hushledger-account-register-1-${cappedRegister.payload.data.dateFrom}-to-${
      cappedRegister.payload.data.dateTo
    }.csv"`,
  )
  assert.deepEqual(
    [...cappedAccountRegisterExport.bytes.slice(0, 3)],
    [0xef, 0xbb, 0xbf],
  )
  const accountRegisterCsvLines = cappedAccountRegisterExport.payload.trimEnd().split('\r\n')
  assert.equal(
    accountRegisterCsvLines[0],
    'Date,Entry Kind,Amount,Currency,Cleared,Running Balance,Account,Account ID,Category,Payee,Counterparty Account,Transfer Direction,Note,Entry ID,Source ID',
  )
  assert(accountRegisterCsvLines.every((line) => line.split(',').length === 15))
  assert.match(accountRegisterCsvLines[1], new RegExp(`^${month}-01,range_start,,HKD,,`))
  const cappedAccountRegisterActivityRows = accountRegisterCsvLines.slice(2)
  assert.equal(cappedAccountRegisterActivityRows.length, 411)
  assert.equal(
    cappedAccountRegisterActivityRows[0].endsWith(
      `transaction:${oldestBulkTransactionId},${oldestBulkTransactionId}`,
    ),
    true,
  )

  const accountRegisterExportNavigation = await api(
    baseUrl,
    `/api/exports/account-register?month=${month}&accountId=1`,
  )
  assert.equal(accountRegisterExportNavigation.response.status, 404)
  assert.equal(accountRegisterExportNavigation.payload.error.code, 'NOT_FOUND')
  const crossOriginAccountRegisterExport = await exportAccountRegisterCsv(
    baseUrl,
    accountRegisterExportBody,
    { origin: 'https://attacker.invalid' },
  )
  assert.equal(crossOriginAccountRegisterExport.response.status, 403)
  assert.equal(crossOriginAccountRegisterExport.payload.error.code, 'ORIGIN_FORBIDDEN')
  const wrongMediaTypeAccountRegisterExport = await fetch(
    `${baseUrl}/api/exports/account-register`,
    {
      method: 'POST',
      headers: { 'content-type': 'text/plain', origin: baseUrl },
      body: JSON.stringify(accountRegisterExportBody),
    },
  )
  assert.equal(wrongMediaTypeAccountRegisterExport.status, 415)
  assert.equal(
    (await wrongMediaTypeAccountRegisterExport.json()).error.code,
    'UNSUPPORTED_MEDIA_TYPE',
  )
  const invalidAccountRegisterExport = await exportAccountRegisterCsv(baseUrl, {
    month: '2026-13',
    accountId: 1,
  })
  assert.equal(invalidAccountRegisterExport.response.status, 400)
  assert.equal(invalidAccountRegisterExport.payload.error.code, 'INVALID_QUERY')
  const extraAccountRegisterExport = await exportAccountRegisterCsv(baseUrl, {
    ...accountRegisterExportBody,
    privateMemo: 'must be rejected',
  })
  assert.equal(extraAccountRegisterExport.response.status, 400)
  assert.equal(extraAccountRegisterExport.payload.error.code, 'INVALID_QUERY')
  const reversedAccountRegisterExport = await exportAccountRegisterCsv(baseUrl, {
    dateFrom: today,
    dateTo: shiftCalendarDay(today, -1),
    accountId: 1,
  })
  assert.equal(reversedAccountRegisterExport.response.status, 400)
  assert.equal(reversedAccountRegisterExport.payload.error.code, 'INVALID_QUERY')
  const missingAccountRegisterExport = await exportAccountRegisterCsv(baseUrl, {
    month,
    accountId: 999999,
  })
  assert.equal(missingAccountRegisterExport.response.status, 404)
  assert.equal(missingAccountRegisterExport.payload.error.code, 'ACCOUNT_NOT_FOUND')
  const sourceBalanceBefore = balancesBeforeTransfer.payload.data.find(
    ({ accountId }) => accountId === account.id,
  )
  const destinationBalanceBefore = balancesBeforeTransfer.payload.data.find(
    ({ accountId }) => accountId === transferDestination.id,
  )
  assert(sourceBalanceBefore)
  assert(destinationBalanceBefore)
  assert.equal(sourceBalanceBefore.recordedBalance, 100_000)
  assert.equal(sourceBalanceBefore.clearedBalance, 100_000)
  assert.equal(sourceBalanceBefore.unclearedBalance, 0)
  assert.equal(sourceBalanceBefore.unclearedCount, 0)

  const offsettingUnclearedBodies = [
    {
      id: '58000000-0000-4000-8000-000000000003',
      type: 'income',
      amountMinor: 10_000,
      currency: account.currency,
      accountId: account.id,
      categoryId: incomeCategory.id,
      occurredOn: today,
      cleared: false,
      payee: 'Offsetting pending income',
      note: '',
    },
    {
      id: '58000000-0000-4000-8000-000000000004',
      type: 'expense',
      amountMinor: 10_000,
      currency: account.currency,
      accountId: account.id,
      categoryId: expenseCategory.id,
      occurredOn: today,
      cleared: false,
      payee: 'Offsetting pending expense',
      note: '',
    },
    {
      id: '58000000-0000-4000-8000-000000000005',
      type: 'expense',
      amountMinor: 5_000,
      currency: account.currency,
      accountId: account.id,
      categoryId: expenseCategory.id,
      occurredOn: shiftCalendarDay(today, -1),
      cleared: false,
      payee: 'Before opening boundary',
      note: '',
    },
  ]
  const offsettingUncleared = await Promise.all(offsettingUnclearedBodies.map((body) => (
    api(baseUrl, '/api/transactions', { method: 'POST', body })
  )))
  assert(offsettingUncleared.every(({ response }) => response.status === 201))
  const balancesWithOffsettingUncleared = await api(
    baseUrl,
    `/api/accounts/balances?month=${month}`,
  )
  const sourceWithOffsettingUncleared = balancesWithOffsettingUncleared.payload.data.find(
    ({ accountId }) => accountId === account.id,
  )
  assert(sourceWithOffsettingUncleared)
  assert.equal(sourceWithOffsettingUncleared.recordedBalance, 100_000)
  assert.equal(sourceWithOffsettingUncleared.clearedBalance, 100_000)
  assert.equal(sourceWithOffsettingUncleared.unclearedBalance, 0)
  assert.equal(sourceWithOffsettingUncleared.unclearedCount, 2)
  const balancesBeforeOpeningMonth = await api(
    baseUrl,
    `/api/accounts/balances?month=${shiftCalendarMonth(month, -1)}`,
  )
  const sourceBeforeOpeningMonth = balancesBeforeOpeningMonth.payload.data.find(
    ({ accountId }) => accountId === account.id,
  )
  assert(sourceBeforeOpeningMonth)
  assert.equal(sourceBeforeOpeningMonth.recordedBalance, null)
  assert.equal(sourceBeforeOpeningMonth.clearedBalance, null)
  assert.equal(sourceBeforeOpeningMonth.unclearedBalance, null)
  assert.equal(sourceBeforeOpeningMonth.unclearedCount, null)
  const deletedOffsettingUncleared = await Promise.all(offsettingUncleared.map(
    ({ payload }, index) => api(
      baseUrl,
      `/api/transactions/${offsettingUnclearedBodies[index].id}`,
      { method: 'DELETE', body: { updatedAt: payload.data.updatedAt } },
    ),
  ))
  assert(deletedOffsettingUncleared.every(({ response }) => response.status === 200))

  const invalidNetWorthMonth = await api(baseUrl, '/api/reports/net-worth?month=2026-13')
  assert.equal(invalidNetWorthMonth.response.status, 400)
  assert.equal(invalidNetWorthMonth.payload.error.code, 'INVALID_QUERY')
  const duplicateNetWorthMonth = await api(
    baseUrl,
    `/api/reports/net-worth?month=${month}&month=${month}`,
  )
  assert.equal(duplicateNetWorthMonth.response.status, 400)
  const rejectedNetWorthWrite = await api(baseUrl, `/api/reports/net-worth?month=${month}`, {
    method: 'POST',
    body: {},
  })
  assert.equal(rejectedNetWorthWrite.response.status, 404)
  const netWorthBeforeTransfer = await api(baseUrl, `/api/reports/net-worth?month=${month}`)
  assert.equal(netWorthBeforeTransfer.response.status, 200, JSON.stringify(netWorthBeforeTransfer.payload))
  assert.equal(netWorthBeforeTransfer.payload.data.length, 6)
  const currentNetWorthBefore = netWorthBeforeTransfer.payload.data.at(-1)
  assert.equal(currentNetWorthBefore.month, month)
  assert.equal(currentNetWorthBefore.accountCount, balancesBeforeTransfer.payload.data.length)
  assert.equal(currentNetWorthBefore.unavailableAccountCount, 0)
  assert.equal(
    currentNetWorthBefore.netWorthMinor,
    balancesBeforeTransfer.payload.data.reduce(
      (total, balance) => total + balance.recordedBalance,
      0,
    ),
  )
  assert.equal(netWorthBeforeTransfer.payload.data[0].netWorthMinor, null)
  assert(netWorthBeforeTransfer.payload.data[0].unavailableAccountCount >= 1)

  const summaryBeforeTransfer = await api(baseUrl, `/api/transactions/summary?month=${month}`)
  assert.equal(summaryBeforeTransfer.response.status, 200)
  const transferBody = {
    id: '60000000-0000-4000-8000-000000000001',
    amountMinor: 50_000,
    currency: 'HKD',
    fromAccountId: account.id,
    toAccountId: transferDestination.id,
    occurredOn: today,
    fromCleared: false,
    toCleared: false,
    note: 'Integration transfer',
  }
  const crossOriginTransfer = await api(baseUrl, '/api/transfers', {
    method: 'POST',
    origin: 'https://attacker.invalid',
    body: transferBody,
  })
  assert.equal(crossOriginTransfer.response.status, 403)
  assert.equal(crossOriginTransfer.payload.error.code, 'ORIGIN_FORBIDDEN')

  const invalidTransfer = await api(baseUrl, '/api/transfers', {
    method: 'POST',
    body: { ...transferBody, id: '60000000-0000-4000-8000-000000000002', toAccountId: account.id },
  })
  assert.equal(invalidTransfer.response.status, 400)
  assert.equal(invalidTransfer.payload.error.code, 'VALIDATION_ERROR')

  const createdTransfer = await api(baseUrl, '/api/transfers', {
    method: 'POST',
    body: transferBody,
  })
  assert.equal(createdTransfer.response.status, 201, JSON.stringify(createdTransfer.payload))
  assert.equal(createdTransfer.payload.data.fromAccountName, account.name)
  assert.equal(createdTransfer.payload.data.toAccountName, transferDestination.name)
  assert.equal(createdTransfer.payload.data.fromCleared, false)
  assert.equal(createdTransfer.payload.data.toCleared, false)

  const balancesWithUnclearedTransfer = await api(baseUrl, `/api/accounts/balances?month=${month}`)
  const sourceWithUnclearedTransfer = balancesWithUnclearedTransfer.payload.data.find(
    ({ accountId }) => accountId === account.id,
  )
  const destinationWithUnclearedTransfer = balancesWithUnclearedTransfer.payload.data.find(
    ({ accountId }) => accountId === transferDestination.id,
  )
  assert(sourceWithUnclearedTransfer)
  assert(destinationWithUnclearedTransfer)
  assert.equal(sourceWithUnclearedTransfer.recordedBalance, 50_000)
  assert.equal(sourceWithUnclearedTransfer.clearedBalance, 100_000)
  assert.equal(sourceWithUnclearedTransfer.unclearedBalance, -50_000)
  assert.equal(sourceWithUnclearedTransfer.unclearedCount, sourceBalanceBefore.unclearedCount + 1)
  assert.equal(
    destinationWithUnclearedTransfer.recordedBalance,
    destinationBalanceBefore.recordedBalance + 50_000,
  )
  assert.equal(
    destinationWithUnclearedTransfer.clearedBalance,
    destinationBalanceBefore.clearedBalance,
  )
  assert.equal(
    destinationWithUnclearedTransfer.unclearedCount,
    destinationBalanceBefore.unclearedCount + 1,
  )
  const sourceRegister = await api(
    baseUrl,
    `/api/accounts/register?month=${month}&accountId=${account.id}`,
  )
  assert.equal(sourceRegister.response.status, 200, JSON.stringify(sourceRegister.payload))
  assert.equal(sourceRegister.payload.data.accountId, account.id)
  assert.equal(sourceRegister.payload.data.startingBalanceMinor, null)
  assert.equal(sourceRegister.payload.data.availableFrom, today)
  assert.equal(sourceRegister.payload.data.endingBalanceMinor, 50_000)
  assert.equal(sourceRegister.payload.data.entryCount, 2)
  assert.deepEqual(
    sourceRegister.payload.data.entries.map((entry) => ({
      kind: entry.kind,
      sourceId: entry.sourceId,
      amountMinor: entry.amountMinor,
      runningBalanceMinor: entry.runningBalanceMinor,
      cleared: entry.cleared,
      transferDirection: entry.transferDirection,
    })),
    [
      {
        kind: 'transfer',
        sourceId: transferBody.id,
        amountMinor: -50_000,
        runningBalanceMinor: 50_000,
        cleared: false,
        transferDirection: 'out',
      },
      {
        kind: 'opening',
        sourceId: null,
        amountMinor: 100_000,
        runningBalanceMinor: 100_000,
        cleared: null,
        transferDirection: null,
      },
    ],
  )
  const registerBeforeOpening = await api(
    baseUrl,
    `/api/accounts/register?month=${shiftCalendarMonth(month, -1)}&accountId=${account.id}`,
  )
  assert.equal(registerBeforeOpening.response.status, 200)
  assert.equal(registerBeforeOpening.payload.data.startingBalanceMinor, null)
  assert.equal(registerBeforeOpening.payload.data.endingBalanceMinor, null)
  assert.equal(registerBeforeOpening.payload.data.entryCount, 0)
  assert.deepEqual(registerBeforeOpening.payload.data.entries, [])
  const destinationRegister = await api(
    baseUrl,
    `/api/accounts/register?month=${month}&accountId=${transferDestination.id}`,
  )
  assert.equal(destinationRegister.response.status, 200)
  assert.equal(destinationRegister.payload.data.startingBalanceMinor, 0)
  assert.equal(destinationRegister.payload.data.endingBalanceMinor, 50_000)
  assert.equal(destinationRegister.payload.data.entries[0].transferDirection, 'in')
  assert.equal(destinationRegister.payload.data.entries[0].runningBalanceMinor, 50_000)
  const netWorthWithTransfer = await api(baseUrl, `/api/reports/net-worth?month=${month}`)
  assert.equal(netWorthWithTransfer.response.status, 200)
  assert.equal(
    netWorthWithTransfer.payload.data.at(-1).netWorthMinor,
    currentNetWorthBefore.netWorthMinor,
  )

  const repeatedTransfer = await api(baseUrl, '/api/transfers', {
    method: 'POST',
    body: transferBody,
  })
  assert.equal(repeatedTransfer.response.status, 200)
  assert.equal(repeatedTransfer.payload.data.id, transferBody.id)

  const conflictingTransfer = await api(baseUrl, '/api/transfers', {
    method: 'POST',
    body: { ...transferBody, amountMinor: transferBody.amountMinor + 1 },
  })
  assert.equal(conflictingTransfer.response.status, 409)
  assert.equal(conflictingTransfer.payload.error.code, 'ID_CONFLICT')

  const listedTransfers = await api(baseUrl, `/api/transfers?month=${month}`)
  assert.equal(listedTransfers.response.status, 200)
  assert.deepEqual(listedTransfers.payload.data.map(({ id }) => id), [transferBody.id])
  const sourceTransfers = await api(
    baseUrl,
    `/api/transfers?month=${month}&accountId=${account.id}`,
  )
  const destinationTransfers = await api(
    baseUrl,
    `/api/transfers?month=${month}&accountId=${transferDestination.id}`,
  )
  const unrelatedTransfers = await api(
    baseUrl,
    `/api/transfers?month=${month}&accountId=${unrelatedTransferAccount.id}`,
  )
  assert.deepEqual(sourceTransfers.payload.data.map(({ id }) => id), [transferBody.id])
  assert.deepEqual(destinationTransfers.payload.data.map(({ id }) => id), [transferBody.id])
  assert.deepEqual(unrelatedTransfers.payload.data, [])

  const sourcePostedTransferFields = {
    amountMinor: transferBody.amountMinor,
    currency: transferBody.currency,
    fromAccountId: transferBody.fromAccountId,
    toAccountId: transferBody.toAccountId,
    occurredOn: transferBody.occurredOn,
    fromCleared: true,
    toCleared: false,
    note: 'Integration transfer left source',
  }
  const sourcePostedTransfer = await api(baseUrl, `/api/transfers/${transferBody.id}`, {
    method: 'PUT',
    body: {
      ...sourcePostedTransferFields,
      updatedAt: createdTransfer.payload.data.updatedAt,
    },
  })
  assert.equal(sourcePostedTransfer.response.status, 200, JSON.stringify(sourcePostedTransfer.payload))
  assert.equal(sourcePostedTransfer.payload.data.fromCleared, true)
  assert.equal(sourcePostedTransfer.payload.data.toCleared, false)
  const balancesWithSourcePostedTransfer = await api(
    baseUrl,
    `/api/accounts/balances?month=${month}`,
  )
  const sourceWithSourcePostedTransfer = balancesWithSourcePostedTransfer.payload.data.find(
    ({ accountId }) => accountId === account.id,
  )
  const destinationWithSourcePostedTransfer = balancesWithSourcePostedTransfer.payload.data.find(
    ({ accountId }) => accountId === transferDestination.id,
  )
  assert(sourceWithSourcePostedTransfer)
  assert(destinationWithSourcePostedTransfer)
  assert.equal(sourceWithSourcePostedTransfer.unclearedCount, sourceBalanceBefore.unclearedCount)
  assert.equal(
    destinationWithSourcePostedTransfer.unclearedCount,
    destinationBalanceBefore.unclearedCount + 1,
  )

  const transferUpdateFields = {
    ...sourcePostedTransferFields,
    toCleared: true,
    note: 'Integration transfer posted',
  }
  const updatedTransfer = await api(baseUrl, `/api/transfers/${transferBody.id}`, {
    method: 'PUT',
    body: {
      ...transferUpdateFields,
      updatedAt: sourcePostedTransfer.payload.data.updatedAt,
    },
  })
  assert.equal(updatedTransfer.response.status, 200, JSON.stringify(updatedTransfer.payload))
  assert.equal(updatedTransfer.payload.data.fromCleared, true)
  assert.equal(updatedTransfer.payload.data.toCleared, true)

  const balancesWithPostedTransfer = await api(baseUrl, `/api/accounts/balances?month=${month}`)
  const sourceWithPostedTransfer = balancesWithPostedTransfer.payload.data.find(
    ({ accountId }) => accountId === account.id,
  )
  const destinationWithPostedTransfer = balancesWithPostedTransfer.payload.data.find(
    ({ accountId }) => accountId === transferDestination.id,
  )
  assert(sourceWithPostedTransfer)
  assert(destinationWithPostedTransfer)
  assert.equal(sourceWithPostedTransfer.recordedBalance, 50_000)
  assert.equal(sourceWithPostedTransfer.clearedBalance, 50_000)
  assert.equal(sourceWithPostedTransfer.unclearedBalance, 0)
  assert.equal(sourceWithPostedTransfer.unclearedCount, sourceBalanceBefore.unclearedCount)
  assert.equal(
    destinationWithPostedTransfer.clearedBalance,
    destinationBalanceBefore.clearedBalance + 50_000,
  )
  assert.equal(destinationWithPostedTransfer.unclearedBalance, destinationBalanceBefore.unclearedBalance)
  assert.equal(destinationWithPostedTransfer.unclearedCount, destinationBalanceBefore.unclearedCount)

  const staleTransferUpdate = await api(baseUrl, `/api/transfers/${transferBody.id}`, {
    method: 'PUT',
    body: {
      ...transferUpdateFields,
      updatedAt: createdTransfer.payload.data.updatedAt,
    },
  })
  assert.equal(staleTransferUpdate.response.status, 409)
  assert.equal(staleTransferUpdate.payload.error.code, 'TRANSFER_VERSION_CONFLICT')

  const summaryAfterTransfer = await api(baseUrl, `/api/transactions/summary?month=${month}`)
  assert.deepEqual(summaryAfterTransfer.payload.data, summaryBeforeTransfer.payload.data)

  const statementDateFrom = `${shiftCalendarMonth(month, -1)}-13`
  const statementCutoff = `${month}-12`
  const statementBeforeOpening = `${shiftCalendarMonth(month, -1)}-12`
  const statementAfterCutoff = `${month}-13`
  const statementAccountResult = await api(baseUrl, '/api/accounts', {
    method: 'POST',
    body: {
      name: 'Statement cycle checking',
      type: 'bank',
      openingBalanceMinor: 200_000,
      openingBalanceOn: statementDateFrom,
    },
  })
  assert.equal(statementAccountResult.response.status, 201, JSON.stringify(statementAccountResult.payload))
  const statementAccount = statementAccountResult.payload.data
  const statementTransactionBodies = [
    {
      id: '59000000-0000-4000-8000-000000000001',
      type: 'expense',
      amountMinor: 9_999,
      currency: statementAccount.currency,
      accountId: statementAccount.id,
      categoryId: expenseCategory.id,
      occurredOn: statementBeforeOpening,
      cleared: true,
      payee: 'Before trustworthy history',
      note: '',
    },
    {
      id: '59000000-0000-4000-8000-000000000002',
      type: 'income',
      amountMinor: 10_000,
      currency: statementAccount.currency,
      accountId: statementAccount.id,
      categoryId: incomeCategory.id,
      occurredOn: statementDateFrom,
      cleared: true,
      payee: 'Statement period opening day',
      note: '',
    },
    {
      id: '59000000-0000-4000-8000-000000000003',
      type: 'expense',
      amountMinor: 3_000,
      currency: statementAccount.currency,
      accountId: statementAccount.id,
      categoryId: expenseCategory.id,
      occurredOn: shiftCalendarDay(statementDateFrom, 10),
      cleared: false,
      payee: 'Prior-month outstanding expense',
      note: '',
    },
    {
      id: '59000000-0000-4000-8000-000000000004',
      type: 'expense',
      amountMinor: 20_000,
      currency: statementAccount.currency,
      accountId: statementAccount.id,
      categoryId: expenseCategory.id,
      occurredOn: statementCutoff,
      cleared: true,
      payee: 'Cutoff-day posted expense',
      note: '',
    },
    {
      id: '59000000-0000-4000-8000-000000000005',
      type: 'income',
      amountMinor: 5_000,
      currency: statementAccount.currency,
      accountId: statementAccount.id,
      categoryId: incomeCategory.id,
      occurredOn: statementCutoff,
      cleared: false,
      payee: '=Cutoff-day pending income',
      note: '',
    },
    {
      id: '59000000-0000-4000-8000-000000000006',
      type: 'expense',
      amountMinor: 7_000,
      currency: statementAccount.currency,
      accountId: statementAccount.id,
      categoryId: expenseCategory.id,
      occurredOn: statementAfterCutoff,
      cleared: true,
      payee: 'After cutoff',
      note: '',
    },
  ]
  const statementTransactions = await Promise.all(statementTransactionBodies.map((body) => (
    api(baseUrl, '/api/transactions', { method: 'POST', body })
  )))
  assert(statementTransactions.every(({ response }) => response.status === 201))

  const statementTransferBody = {
    id: '59000000-0000-4000-8000-000000000007',
    amountMinor: 4_000,
    currency: statementAccount.currency,
    fromAccountId: statementAccount.id,
    toAccountId: transferDestination.id,
    occurredOn: statementCutoff,
    fromCleared: false,
    toCleared: true,
    note: '@Cutoff-day mixed-clearing transfer',
  }
  const statementTransfer = await api(baseUrl, '/api/transfers', {
    method: 'POST',
    body: statementTransferBody,
  })
  assert.equal(statementTransfer.response.status, 201, JSON.stringify(statementTransfer.payload))

  const statementQuery = `dateFrom=${statementDateFrom}&dateTo=${statementCutoff}&accountId=${statementAccount.id}`
  const statementRegister = await api(baseUrl, `/api/accounts/register?${statementQuery}`)
  assert.equal(statementRegister.response.status, 200, JSON.stringify(statementRegister.payload))
  assert.match(statementRegister.response.headers.get('cache-control') ?? '', /private, no-store/)
  assert.equal(statementRegister.payload.data.dateFrom, statementDateFrom)
  assert.equal(statementRegister.payload.data.dateTo, statementCutoff)
  assert.equal(statementRegister.payload.data.startingBalanceMinor, 200_000)
  assert.equal(statementRegister.payload.data.endingBalanceMinor, 188_000)
  assert.equal(statementRegister.payload.data.clearedEndingBalanceMinor, 190_000)
  assert.equal(statementRegister.payload.data.unclearedEndingBalanceMinor, -2_000)
  assert.equal(statementRegister.payload.data.unclearedCount, 3)
  assert.equal(statementRegister.payload.data.entryCount, 5)
  assert.equal(statementRegister.payload.data.entries.length, 5)
  assert.equal(statementRegister.payload.data.entries[0].occurredOn, statementCutoff)
  assert.equal(statementRegister.payload.data.entries[0].runningBalanceMinor, 188_000)
  assert.equal(
    statementRegister.payload.data.entries.some(({ sourceId }) => (
      sourceId === statementTransactionBodies[0].id || sourceId === statementTransactionBodies[5].id
    )),
    false,
  )
  const statementRegisterTransfer = statementRegister.payload.data.entries.find(
    ({ sourceId }) => sourceId === statementTransferBody.id,
  )
  assert(statementRegisterTransfer)
  assert.equal(statementRegisterTransfer.amountMinor, -4_000)
  assert.equal(statementRegisterTransfer.cleared, false)
  assert.equal(statementRegisterTransfer.transferDirection, 'out')
  assert.equal(statementRegisterTransfer.counterpartyAccountName, transferDestination.name)

  const accountRegisterRevisionProbe = await downloadLedgerBackup(baseUrl)
  assert.equal(
    accountRegisterRevisionProbe.response.status,
    200,
    JSON.stringify(accountRegisterRevisionProbe.payload),
  )
  const revisionBeforeAccountRegisterExports = await api(baseUrl, '/api/backups/ledger', {
    method: 'POST',
    body: { mode: 'preview', backup: accountRegisterRevisionProbe.payload },
  })
  assert.equal(
    revisionBeforeAccountRegisterExports.response.status,
    200,
    JSON.stringify(revisionBeforeAccountRegisterExports.payload),
  )
  const statementAccountRegisterExportBody = {
    dateFrom: statementDateFrom,
    dateTo: statementCutoff,
    accountId: statementAccount.id,
  }
  const statementAccountRegisterExport = await exportAccountRegisterCsv(
    baseUrl,
    statementAccountRegisterExportBody,
  )
  const repeatedStatementAccountRegisterExport = await exportAccountRegisterCsv(
    baseUrl,
    statementAccountRegisterExportBody,
  )
  assert.equal(
    statementAccountRegisterExport.response.status,
    200,
    JSON.stringify(statementAccountRegisterExport.payload),
  )
  assert.equal(repeatedStatementAccountRegisterExport.response.status, 200)
  assert.equal(
    repeatedStatementAccountRegisterExport.payload,
    statementAccountRegisterExport.payload,
  )
  assert.deepEqual(
    repeatedStatementAccountRegisterExport.bytes,
    statementAccountRegisterExport.bytes,
  )
  assert.equal(
    statementAccountRegisterExport.response.headers.get('content-disposition'),
    `attachment; filename="hushledger-account-register-${statementAccount.id}-${
      statementDateFrom
    }-to-${statementCutoff}.csv"`,
  )
  const statementAccountRegisterCsvLines = statementAccountRegisterExport.payload
    .trimEnd()
    .split('\r\n')
  assert(statementAccountRegisterCsvLines.every((line) => line.split(',').length === 15))
  const statementAccountRegisterRows = statementAccountRegisterCsvLines
    .slice(1)
    .map((line) => line.split(','))
  assert.deepEqual(statementAccountRegisterRows[0].slice(0, 6), [
    statementDateFrom,
    'range_start',
    '',
    statementAccount.currency,
    '',
    '2000.00',
  ])
  const statementActivityRows = statementAccountRegisterRows.slice(1)
  assert.equal(statementActivityRows.length, 5)
  assert.deepEqual(
    statementActivityRows.map(([date]) => date),
    statementActivityRows.map(([date]) => date).toSorted(),
  )
  assert.deepEqual(
    new Set(statementActivityRows.map((row) => row[14])),
    new Set([
      ...statementTransactionBodies.slice(1, 5).map(({ id }) => id),
      statementTransferBody.id,
    ]),
  )
  let statementRunningBalance = 2_000
  for (const row of statementActivityRows) {
    assert.match(row[2], /^-?\d+\.\d{2}$/)
    statementRunningBalance += Number(row[2])
    assert.equal(Number(row[5]), statementRunningBalance)
  }
  assert.equal(statementRunningBalance, 1_880)
  assert.equal(statementActivityRows.at(-1)[5], '1880.00')
  const formulaSafeStatementRow = statementActivityRows.find(
    (row) => row[14] === statementTransactionBodies[4].id,
  )
  assert(formulaSafeStatementRow)
  assert.equal(formulaSafeStatementRow[9], `"'=Cutoff-day pending income"`)
  const exportedStatementTransferRow = statementActivityRows.find(
    (row) => row[14] === statementTransferBody.id,
  )
  assert(exportedStatementTransferRow)
  assert.equal(exportedStatementTransferRow[1], 'transfer')
  assert.equal(exportedStatementTransferRow[2], '-40.00')
  assert.equal(exportedStatementTransferRow[4], 'Uncleared')
  assert.equal(exportedStatementTransferRow[5], '1880.00')
  assert.equal(exportedStatementTransferRow[10], `"${transferDestination.name}"`)
  assert.equal(exportedStatementTransferRow[11], 'out')
  assert.equal(exportedStatementTransferRow[12], `"'@Cutoff-day mixed-clearing transfer"`)
  const revisionAfterAccountRegisterExports = await api(baseUrl, '/api/backups/ledger', {
    method: 'POST',
    body: { mode: 'preview', backup: accountRegisterRevisionProbe.payload },
  })
  assert.equal(revisionAfterAccountRegisterExports.response.status, 200)
  assert.equal(
    revisionAfterAccountRegisterExports.payload.data.currentRevision,
    revisionBeforeAccountRegisterExports.payload.data.currentRevision,
  )
  assert.equal(
    revisionAfterAccountRegisterExports.payload.data.currentDigest,
    revisionBeforeAccountRegisterExports.payload.data.currentDigest,
  )

  const statementTransactionsQuery = await api(baseUrl, '/api/transactions/query', {
    method: 'POST',
    body: {
      month,
      scope: 'range',
      dateFrom: statementDateFrom,
      dateTo: statementCutoff,
      accountId: statementAccount.id,
      sort: 'date_desc',
    },
  })
  assert.equal(statementTransactionsQuery.response.status, 200)
  assert.deepEqual(
    new Set(statementTransactionsQuery.payload.data.transactions.map(({ id }) => id)),
    new Set(statementTransactionBodies.slice(1, 5).map(({ id }) => id)),
  )
  const statementTransfersQuery = await api(baseUrl, `/api/transfers?${statementQuery}`)
  assert.equal(statementTransfersQuery.response.status, 200)
  assert.deepEqual(statementTransfersQuery.payload.data.map(({ id }) => id), [statementTransferBody.id])

  const rangeIncludingOpening = await api(
    baseUrl,
    `/api/accounts/register?dateFrom=${statementBeforeOpening}&dateTo=${statementCutoff}&accountId=${statementAccount.id}`,
  )
  assert.equal(rangeIncludingOpening.response.status, 200)
  assert.equal(rangeIncludingOpening.payload.data.startingBalanceMinor, null)
  assert.equal(rangeIncludingOpening.payload.data.availableFrom, statementDateFrom)
  assert.equal(rangeIncludingOpening.payload.data.entryCount, 6)
  assert.equal(
    rangeIncludingOpening.payload.data.entries.at(-1).kind,
    'opening',
  )
  assert.equal(rangeIncludingOpening.payload.data.entries.at(-1).amountMinor, 200_000)
  const rangeBeforeOpening = await api(
    baseUrl,
    `/api/accounts/register?dateFrom=${shiftCalendarMonth(month, -1)}-01&dateTo=${statementBeforeOpening}&accountId=${statementAccount.id}`,
  )
  assert.equal(rangeBeforeOpening.response.status, 200)
  assert.equal(rangeBeforeOpening.payload.data.endingBalanceMinor, null)
  assert.equal(rangeBeforeOpening.payload.data.clearedEndingBalanceMinor, null)
  assert.equal(rangeBeforeOpening.payload.data.unclearedEndingBalanceMinor, null)
  assert.equal(rangeBeforeOpening.payload.data.unclearedCount, null)
  assert.equal(rangeBeforeOpening.payload.data.entryCount, 0)

  for (const path of [
    `/api/accounts/register?dateFrom=${statementDateFrom}&accountId=${statementAccount.id}`,
    `/api/accounts/register?dateFrom=${statementCutoff}&dateTo=${statementDateFrom}&accountId=${statementAccount.id}`,
    `/api/accounts/register?month=${month}&dateFrom=${statementDateFrom}&dateTo=${statementCutoff}&accountId=${statementAccount.id}`,
    `/api/accounts/register?dateFrom=${statementDateFrom}&dateFrom=${statementDateFrom}&dateTo=${statementCutoff}&accountId=${statementAccount.id}`,
  ]) {
    const invalidStatementRegister = await api(baseUrl, path)
    assert.equal(invalidStatementRegister.response.status, 400, path)
    assert.equal(invalidStatementRegister.payload.error.code, 'INVALID_QUERY')
  }
  const missingStatementAccount = await api(
    baseUrl,
    `/api/accounts/register?dateFrom=${statementDateFrom}&dateTo=${statementCutoff}&accountId=999999`,
  )
  assert.equal(missingStatementAccount.response.status, 404)

  const clearedStatementTransfer = await api(baseUrl, `/api/transfers/${statementTransferBody.id}`, {
    method: 'PUT',
    body: {
      amountMinor: statementTransferBody.amountMinor,
      currency: statementTransferBody.currency,
      fromAccountId: statementTransferBody.fromAccountId,
      toAccountId: statementTransferBody.toAccountId,
      occurredOn: statementTransferBody.occurredOn,
      fromCleared: true,
      toCleared: true,
      note: statementTransferBody.note,
      updatedAt: statementTransfer.payload.data.updatedAt,
    },
  })
  assert.equal(clearedStatementTransfer.response.status, 200)
  const reconciledTransferRegister = await api(baseUrl, `/api/accounts/register?${statementQuery}`)
  assert.equal(reconciledTransferRegister.payload.data.endingBalanceMinor, 188_000)
  assert.equal(reconciledTransferRegister.payload.data.clearedEndingBalanceMinor, 186_000)
  assert.equal(reconciledTransferRegister.payload.data.unclearedEndingBalanceMinor, 2_000)
  assert.equal(reconciledTransferRegister.payload.data.unclearedCount, 2)

  const outstandingTransaction = statementTransactions[2].payload.data
  const clearedOutstandingTransaction = await api(
    baseUrl,
    `/api/transactions/${outstandingTransaction.id}`,
    {
      method: 'PUT',
      body: {
        type: outstandingTransaction.type,
        amountMinor: outstandingTransaction.amountMinor,
        currency: outstandingTransaction.currency,
        accountId: outstandingTransaction.accountId,
        categoryId: outstandingTransaction.categoryId,
        occurredOn: outstandingTransaction.occurredOn,
        cleared: true,
        payee: outstandingTransaction.payee,
        note: outstandingTransaction.note,
        updatedAt: outstandingTransaction.updatedAt,
      },
    },
  )
  assert.equal(clearedOutstandingTransaction.response.status, 200)
  const reconciledTransactionRegister = await api(baseUrl, `/api/accounts/register?${statementQuery}`)
  assert.equal(reconciledTransactionRegister.payload.data.endingBalanceMinor, 188_000)
  assert.equal(reconciledTransactionRegister.payload.data.clearedEndingBalanceMinor, 183_000)
  assert.equal(reconciledTransactionRegister.payload.data.unclearedEndingBalanceMinor, 5_000)
  assert.equal(reconciledTransactionRegister.payload.data.unclearedCount, 1)

  const statementTransactionsForCleanup = statementTransactions.map(({ payload }) => payload.data)
  statementTransactionsForCleanup[2] = clearedOutstandingTransaction.payload.data
  const deletedStatementTransactions = await Promise.all(statementTransactionsForCleanup.map(
    ({ id, updatedAt }) => api(baseUrl, `/api/transactions/${id}`, {
      method: 'DELETE',
      body: { updatedAt },
    }),
  ))
  assert(deletedStatementTransactions.every(({ response }) => response.status === 200))
  const deletedStatementTransfer = await api(baseUrl, `/api/transfers/${statementTransferBody.id}`, {
    method: 'DELETE',
    body: { updatedAt: clearedStatementTransfer.payload.data.updatedAt },
  })
  assert.equal(deletedStatementTransfer.response.status, 200)
  const zeroedStatementAccount = await api(baseUrl, `/api/accounts/${statementAccount.id}`, {
    method: 'PUT',
    body: {
      name: statementAccount.name,
      type: statementAccount.type,
      openingBalanceMinor: 0,
      openingBalanceOn: statementAccount.openingBalanceOn,
      updatedAt: statementAccount.updatedAt,
    },
  })
  assert.equal(zeroedStatementAccount.response.status, 200)
  const disabledStatementAccount = await api(baseUrl, `/api/accounts/${statementAccount.id}`, {
    method: 'PATCH',
    body: { isActive: false, updatedAt: zeroedStatementAccount.payload.data.updatedAt },
  })
  assert.equal(disabledStatementAccount.response.status, 200)

  const temporaryTransferBody = {
    ...transferBody,
    id: '60000000-0000-4000-8000-000000000003',
    amountMinor: 25_000,
    note: 'Temporary transfer',
  }
  const temporaryTransfer = await api(baseUrl, '/api/transfers', {
    method: 'POST',
    body: temporaryTransferBody,
  })
  assert.equal(temporaryTransfer.response.status, 201)
  const deletedTransfer = await api(baseUrl, `/api/transfers/${temporaryTransferBody.id}`, {
    method: 'DELETE',
    body: { updatedAt: temporaryTransfer.payload.data.updatedAt },
  })
  assert.equal(deletedTransfer.response.status, 200)
  const repeatedTransferDelete = await api(baseUrl, `/api/transfers/${temporaryTransferBody.id}`, {
    method: 'DELETE',
    body: { updatedAt: temporaryTransfer.payload.data.updatedAt },
  })
  assert.equal(repeatedTransferDelete.response.status, 404)

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

  const privateFilterBody = { month, search: 'export bulk' }
  const privateQuery = await api(baseUrl, '/api/transactions/query', {
    method: 'POST',
    body: privateFilterBody,
  })
  assert.equal(privateQuery.response.status, 200)
  assert.equal(privateQuery.response.url, `${baseUrl}/api/transactions/query`)
  assert.match(privateQuery.response.headers.get('cache-control') ?? '', /private.*no-store/)
  assert.equal(privateQuery.payload.data.transactions.length, 200)
  assert.deepEqual(privateQuery.payload.data.summary, completeFilterSummary.payload.data)

  const exactAmountFilterBody = { ...privateFilterBody, amountMinor: 225 }
  const exactAmountPrivateQuery = await api(baseUrl, '/api/transactions/query', {
    method: 'POST',
    body: exactAmountFilterBody,
  })
  assert.equal(exactAmountPrivateQuery.response.status, 200)
  assert.equal(exactAmountPrivateQuery.response.url, `${baseUrl}/api/transactions/query`)
  assert.equal(exactAmountPrivateQuery.payload.data.transactions.length, 1)
  assert.equal(exactAmountPrivateQuery.payload.data.transactions[0].amountMinor, 225)
  assert.deepEqual(exactAmountPrivateQuery.payload.data.summary, {
    transactionCount: 1,
    income: 0,
    expense: 225,
    net: -225,
  })

  const exactAmountLegacyQuery = await api(
    baseUrl,
    `/api/transactions?month=${month}&search=export%20bulk&amountMinor=225`,
  )
  assert.equal(exactAmountLegacyQuery.response.status, 200)
  assert.deepEqual(
    exactAmountLegacyQuery.payload.data.map(({ amountMinor }) => amountMinor),
    [225],
  )

  const crossOriginPrivateQuery = await api(baseUrl, '/api/transactions/query', {
    method: 'POST',
    origin: 'https://attacker.invalid',
    body: privateFilterBody,
  })
  assert.equal(crossOriginPrivateQuery.response.status, 403)
  assert.equal(crossOriginPrivateQuery.payload.error.code, 'ORIGIN_FORBIDDEN')

  const wrongMediaTypePrivateQuery = await fetch(`${baseUrl}/api/transactions/query`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain', origin: baseUrl },
    body: JSON.stringify(privateFilterBody),
  })
  assert.equal(wrongMediaTypePrivateQuery.status, 415)
  assert.equal((await wrongMediaTypePrivateQuery.json()).error.code, 'UNSUPPORTED_MEDIA_TYPE')

  const invalidPrivateQuery = await api(baseUrl, '/api/transactions/query', {
    method: 'POST',
    body: { ...privateFilterBody, privateMemo: 'must be rejected' },
  })
  assert.equal(invalidPrivateQuery.response.status, 400)
  assert.equal(invalidPrivateQuery.payload.error.code, 'INVALID_QUERY')

  for (const amountMinor of [0, -1, Number.MAX_SAFE_INTEGER + 1]) {
    const invalidAmountPrivateQuery = await api(baseUrl, '/api/transactions/query', {
      method: 'POST',
      body: { ...privateFilterBody, amountMinor },
    })
    assert.equal(invalidAmountPrivateQuery.response.status, 400)
    assert.equal(invalidAmountPrivateQuery.payload.error.code, 'INVALID_QUERY')
  }

  const privateCsvExport = await api(baseUrl, '/api/exports/transactions', {
    method: 'POST',
    body: privateFilterBody,
  })
  assert.equal(privateCsvExport.response.status, 200)
  assert.equal(privateCsvExport.response.url, `${baseUrl}/api/exports/transactions`)
  assert.match(privateCsvExport.response.headers.get('content-type') ?? '', /^text\/csv;\s*charset=utf-8/i)
  assert.match(privateCsvExport.response.headers.get('cache-control') ?? '', /private.*no-store/)
  assert.equal(privateCsvExport.response.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(
    privateCsvExport.response.headers.get('content-disposition'),
    `attachment; filename="hushledger-transactions-${month}.csv"`,
  )
  assert.deepEqual([...privateCsvExport.bytes.slice(0, 3)], [0xef, 0xbb, 0xbf])
  assert(privateCsvExport.payload.startsWith('Date,Type,Amount,Currency'))
  assert.match(privateCsvExport.payload.split('\r\n', 1)[0], /Transaction ID$/)
  assert.equal(privateCsvExport.payload.trimEnd().split('\r\n').length - 1, 205)

  const exactAmountPrivateCsvExport = await api(baseUrl, '/api/exports/transactions', {
    method: 'POST',
    body: exactAmountFilterBody,
  })
  assert.equal(exactAmountPrivateCsvExport.response.status, 200)
  assert.equal(exactAmountPrivateCsvExport.response.url, `${baseUrl}/api/exports/transactions`)
  assert.equal(exactAmountPrivateCsvExport.payload.trimEnd().split('\r\n').length - 1, 1)
  assert.match(exactAmountPrivateCsvExport.payload, /,-2\.25,HKD,/)

  const crossOriginPrivateExport = await api(baseUrl, '/api/exports/transactions', {
    method: 'POST',
    origin: 'https://attacker.invalid',
    body: privateFilterBody,
  })
  assert.equal(crossOriginPrivateExport.response.status, 403)
  assert.equal(crossOriginPrivateExport.payload.error.code, 'ORIGIN_FORBIDDEN')

  const wrongMediaTypePrivateExport = await fetch(`${baseUrl}/api/exports/transactions`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain', origin: baseUrl },
    body: JSON.stringify(privateFilterBody),
  })
  assert.equal(wrongMediaTypePrivateExport.status, 415)
  assert.equal((await wrongMediaTypePrivateExport.json()).error.code, 'UNSUPPORTED_MEDIA_TYPE')

  const invalidPrivateExport = await api(baseUrl, '/api/exports/transactions', {
    method: 'POST',
    body: { ...privateFilterBody, payee: '   ' },
  })
  assert.equal(invalidPrivateExport.response.status, 400)
  assert.equal(invalidPrivateExport.payload.error.code, 'INVALID_QUERY')

  const navigationCsvExport = await api(
    baseUrl,
    `/api/exports/transactions?month=${month}&search=export%20bulk`,
  )
  assert.equal(navigationCsvExport.response.status, 404)
  assert.equal(navigationCsvExport.payload.error.code, 'NOT_FOUND')
  assert.match(navigationCsvExport.response.headers.get('cache-control') ?? '', /private.*no-store/)
  assert.equal(navigationCsvExport.response.headers.get('content-disposition'), null)

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

  const exactPayeeRows = await api(
    baseUrl,
    `/api/transactions?month=${month}&payee=%20EXPORT%20BULK%20`,
  )
  assert.equal(exactPayeeRows.response.status, 200)
  assert.equal(exactPayeeRows.payload.data.length, 200)
  const exactPayeeSummary = await api(
    baseUrl,
    `/api/transactions/summary?month=${month}&payee=%20EXPORT%20BULK%20`,
  )
  assert.equal(exactPayeeSummary.response.status, 200)
  assert.deepEqual(exactPayeeSummary.payload.data, completeFilterSummary.payload.data)
  const differentPayeeRows = await api(
    baseUrl,
    `/api/transactions?month=${month}&payee=export%20bulk%20shop`,
  )
  assert.equal(differentPayeeRows.response.status, 200)
  assert.deepEqual(differentPayeeRows.payload.data, [])
  const rejectedBlankPayee = await api(baseUrl, `/api/transactions?month=${month}&payee=%20%20%20`)
  assert.equal(rejectedBlankPayee.response.status, 400)
  assert.equal(rejectedBlankPayee.payload.error.code, 'INVALID_QUERY')

  const accentedPayeeBodies = [
    {
      id: '54000000-0000-4000-8000-000000000001',
      type: 'expense',
      amountMinor: 125,
      currency: 'HKD',
      accountId: 1,
      categoryId: 3,
      occurredOn: today,
      cleared: false,
      payee: ' Épicerie ',
      note: '',
    },
    {
      id: '54000000-0000-4000-8000-000000000002',
      type: 'expense',
      amountMinor: 275,
      currency: 'HKD',
      accountId: 1,
      categoryId: 3,
      occurredOn: today,
      cleared: false,
      payee: 'e\u0301PICERIE',
      note: '',
    },
  ]
  const accentedPayees = await Promise.all(accentedPayeeBodies.map((body) => (
    api(baseUrl, '/api/transactions', { method: 'POST', body })
  )))
  assert(accentedPayees.every(({ response }) => response.status === 201))

  const accentedPayeeRows = await api(
    baseUrl,
    `/api/transactions?month=${month}&payee=${encodeURIComponent(' ÉPICERIE ')}`,
  )
  assert.equal(accentedPayeeRows.response.status, 200)
  assert.deepEqual(
    accentedPayeeRows.payload.data.map(({ id }) => id).sort(),
    accentedPayeeBodies.map(({ id }) => id),
  )
  const accentedPayeeSummary = await api(
    baseUrl,
    `/api/transactions/summary?month=${month}&payee=${encodeURIComponent('épicerie')}`,
  )
  assert.equal(accentedPayeeSummary.response.status, 200)
  assert.deepEqual(accentedPayeeSummary.payload.data, {
    transactionCount: 2,
    income: 0,
    expense: 400,
    net: -400,
  })
  const accentedMonthlySummary = await api(baseUrl, `/api/summary?month=${month}`)
  assert.deepEqual(
    accentedMonthlySummary.payload.data.expenseByPayee.find(({ payee }) => payee === 'Épicerie'),
    { payee: 'Épicerie', amountMinor: 400, transactionCount: 2 },
  )
  const accentedPayeeExport = await exportTransactionCsv(baseUrl, { month, payee: 'épicerie' })
  assert.equal(accentedPayeeExport.response.status, 200)
  assert.equal(accentedPayeeExport.payload.trimEnd().split('\r\n').length - 1, 2)

  const deletedAccentedPayees = await Promise.all(accentedPayees.map(({ payload }, index) => (
    api(baseUrl, `/api/transactions/${accentedPayeeBodies[index].id}`, {
      method: 'DELETE',
      body: { updatedAt: payload.data.updatedAt },
    })
  )))
  assert(deletedAccentedPayees.every(({ response }) => response.status === 200))

  const uncappedCsvExport = await exportTransactionCsv(baseUrl, { month, search: 'export bulk' })
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

  const monthOnlyHistorySearch = await api(
    baseUrl,
    `/api/transactions?month=${month}&search=historical%20trend`,
  )
  assert.equal(monthOnlyHistorySearch.response.status, 200)
  assert.deepEqual(monthOnlyHistorySearch.payload.data, [])
  const allHistorySearch = await api(
    baseUrl,
    `/api/transactions?month=${month}&scope=all&search=historical%20trend`,
  )
  assert.equal(allHistorySearch.response.status, 200)
  assert.deepEqual(
    allHistorySearch.payload.data.map(({ id }) => id),
    ['30000000-0000-4000-8000-000000999999'],
  )
  const allHistorySummary = await api(
    baseUrl,
    `/api/transactions/summary?month=${month}&scope=all&search=historical%20trend`,
  )
  assert.equal(allHistorySummary.response.status, 200)
  assert.deepEqual(allHistorySummary.payload.data, {
    transactionCount: 1,
    income: 0,
    expense: 12_345,
    net: -12_345,
  })
  const allHistoryExport = await api(baseUrl, '/api/exports/transactions', {
    method: 'POST',
    body: { month, scope: 'all', search: 'historical trend' },
  })
  assert.equal(allHistoryExport.response.status, 200)
  assert.equal(
    allHistoryExport.response.headers.get('content-disposition'),
    'attachment; filename="hushledger-transactions-all.csv"',
  )
  assert.equal(allHistoryExport.payload.trimEnd().split('\r\n').length - 1, 1)
  const historicalDate = `${previousMonth}-15`
  const customRangeSearch = await api(
    baseUrl,
    `/api/transactions?month=${month}&scope=range&dateFrom=${historicalDate}&dateTo=${historicalDate}&search=historical%20trend`,
  )
  assert.equal(customRangeSearch.response.status, 200)
  assert.deepEqual(
    customRangeSearch.payload.data.map(({ id }) => id),
    ['30000000-0000-4000-8000-000000999999'],
  )
  const customRangeSummary = await api(
    baseUrl,
    `/api/transactions/summary?month=${month}&scope=range&dateFrom=${historicalDate}&dateTo=${historicalDate}&search=historical%20trend`,
  )
  assert.equal(customRangeSummary.response.status, 200)
  assert.deepEqual(customRangeSummary.payload.data, allHistorySummary.payload.data)
  const customRangeExport = await api(baseUrl, '/api/exports/transactions', {
    method: 'POST',
    body: {
      month,
      scope: 'range',
      dateFrom: historicalDate,
      dateTo: historicalDate,
      search: 'historical trend',
    },
  })
  assert.equal(customRangeExport.response.status, 200)
  assert.equal(
    customRangeExport.response.headers.get('content-disposition'),
    `attachment; filename="hushledger-transactions-${historicalDate}-to-${historicalDate}.csv"`,
  )
  assert.equal(customRangeExport.payload.trimEnd().split('\r\n').length - 1, 1)
  for (const rejectedRangeQuery of [
    `/api/transactions?month=${month}&scope=range&dateFrom=${historicalDate}`,
    `/api/transactions?month=${month}&scope=range&dateFrom=${month}-01&dateTo=${historicalDate}`,
    `/api/transactions?month=${month}&scope=month&dateFrom=${historicalDate}&dateTo=${historicalDate}`,
  ]) {
    const rejected = await api(baseUrl, rejectedRangeQuery)
    assert.equal(rejected.response.status, 400)
    assert.equal(rejected.payload.error.code, 'INVALID_QUERY')
  }
  const rejectedDateScope = await api(
    baseUrl,
    `/api/transactions?month=${month}&scope=year`,
  )
  assert.equal(rejectedDateScope.response.status, 400)
  assert.equal(rejectedDateScope.payload.error.code, 'INVALID_QUERY')

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

  const sortedCsvExport = await exportTransactionCsv(baseUrl, {
    month,
    search: 'export bulk',
    sort: 'amount_desc',
  })
  assert.equal(sortedCsvExport.response.status, 200)
  assert.equal(sortedCsvExport.payload.split('\r\n')[1].split(',')[2], '-3.05')

  const taggedCsvExport = await exportTransactionCsv(baseUrl, { month, tag: 'Summer2026' })
  assert.equal(taggedCsvExport.response.status, 200)
  assert.equal(taggedCsvExport.payload.trimEnd().split('\r\n').length - 1, 1)
  assert.match(taggedCsvExport.payload, /Trip planning #Summer2026/)

  const referenceFilteredCsvExport = await exportTransactionCsv(baseUrl, {
    month,
    accountId: 1,
    categoryId: 3,
    search: 'export bulk',
  })
  assert.equal(referenceFilteredCsvExport.response.status, 200)
  assert.equal(referenceFilteredCsvExport.payload.trimEnd().split('\r\n').length - 1, 205)

  const bulkClearingIds = [
    '30000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000002',
  ]
  const bulkClearingBefore = await Promise.all(
    bulkClearingIds.map((id) => api(baseUrl, `/api/transactions/${id}`)),
  )
  assert(bulkClearingBefore.every(({ response, payload }) => (
    response.status === 200 && payload.data.cleared === true
  )))
  const bulkClearingVersions = bulkClearingBefore.map(({ payload }) => ({
    id: payload.data.id,
    updatedAt: payload.data.updatedAt,
  }))
  const crossOriginBulkClearing = await api(baseUrl, '/api/transactions/clearing', {
    method: 'PATCH',
    origin: 'https://attacker.invalid',
    body: { cleared: false, transactions: bulkClearingVersions },
  })
  assert.equal(crossOriginBulkClearing.response.status, 403)
  assert.equal(crossOriginBulkClearing.payload.error.code, 'ORIGIN_FORBIDDEN')
  const duplicateBulkClearing = await api(baseUrl, '/api/transactions/clearing', {
    method: 'PATCH',
    body: { cleared: false, transactions: [bulkClearingVersions[0], bulkClearingVersions[0]] },
  })
  assert.equal(duplicateBulkClearing.response.status, 400)
  assert.equal(duplicateBulkClearing.payload.error.code, 'VALIDATION_ERROR')

  const unclearedBulk = await api(baseUrl, '/api/transactions/clearing', {
    method: 'PATCH',
    body: { cleared: false, transactions: bulkClearingVersions },
  })
  assert.equal(unclearedBulk.response.status, 200, JSON.stringify(unclearedBulk.payload))
  assert.deepEqual(unclearedBulk.payload.data, { updated: 2, cleared: false })
  const bulkClearingAfter = await Promise.all(
    bulkClearingIds.map((id) => api(baseUrl, `/api/transactions/${id}`)),
  )
  assert(bulkClearingAfter.every(({ payload }) => payload.data.cleared === false))
  const currentBulkClearingVersions = bulkClearingAfter.map(({ payload }) => ({
    id: payload.data.id,
    updatedAt: payload.data.updatedAt,
  }))
  const staleBulkClearing = await api(baseUrl, '/api/transactions/clearing', {
    method: 'PATCH',
    body: {
      cleared: true,
      transactions: [bulkClearingVersions[0], currentBulkClearingVersions[1]],
    },
  })
  assert.equal(staleBulkClearing.response.status, 409)
  assert.equal(staleBulkClearing.payload.error.code, 'TRANSACTION_VERSION_CONFLICT')
  const bulkClearingAfterConflict = await Promise.all(
    bulkClearingIds.map((id) => api(baseUrl, `/api/transactions/${id}`)),
  )
  assert(bulkClearingAfterConflict.every(({ payload }) => payload.data.cleared === false))

  const restoredBulkClearing = await api(baseUrl, '/api/transactions/clearing', {
    method: 'PATCH',
    body: {
      cleared: true,
      transactions: bulkClearingAfterConflict.map(({ payload }) => ({
        id: payload.data.id,
        updatedAt: payload.data.updatedAt,
      })),
    },
  })
  assert.equal(restoredBulkClearing.response.status, 200)
  assert.deepEqual(restoredBulkClearing.payload.data, { updated: 2, cleared: true })

  const bulkCategoryBefore = await Promise.all(
    bulkClearingIds.map((id) => api(baseUrl, `/api/transactions/${id}`)),
  )
  assert(bulkCategoryBefore.every(({ payload }) => payload.data.categoryId === 3))
  const bulkCategoryVersions = bulkCategoryBefore.map(({ payload }) => ({
    id: payload.data.id,
    updatedAt: payload.data.updatedAt,
  }))
  const crossOriginBulkCategory = await api(baseUrl, '/api/transactions/category', {
    method: 'PATCH',
    origin: 'https://attacker.invalid',
    body: { categoryId: expenseCategory.id, transactions: bulkCategoryVersions },
  })
  assert.equal(crossOriginBulkCategory.response.status, 403)
  assert.equal(crossOriginBulkCategory.payload.error.code, 'ORIGIN_FORBIDDEN')
  const duplicateBulkCategory = await api(baseUrl, '/api/transactions/category', {
    method: 'PATCH',
    body: {
      categoryId: expenseCategory.id,
      transactions: [bulkCategoryVersions[0], bulkCategoryVersions[0]],
    },
  })
  assert.equal(duplicateBulkCategory.response.status, 400)
  assert.equal(duplicateBulkCategory.payload.error.code, 'VALIDATION_ERROR')
  const missingBulkCategory = await api(baseUrl, '/api/transactions/category', {
    method: 'PATCH',
    body: { categoryId: 999999, transactions: bulkCategoryVersions },
  })
  assert.equal(missingBulkCategory.response.status, 400)
  assert.equal(missingBulkCategory.payload.error.code, 'CATEGORY_INVALID')
  const mismatchedBulkCategory = await api(baseUrl, '/api/transactions/category', {
    method: 'PATCH',
    body: { categoryId: incomeCategory.id, transactions: bulkCategoryVersions },
  })
  assert.equal(mismatchedBulkCategory.response.status, 400)
  assert.equal(mismatchedBulkCategory.payload.error.code, 'CATEGORY_TYPE_MISMATCH')

  const cashFlowBeforeMixed = await api(baseUrl, `/api/summary?month=${month}`)
  const cashFlowBeforeMixedPoint = cashFlowBeforeMixed.payload.data.cashFlowTrend.at(-1)
  assert(cashFlowBeforeMixedPoint)

  const mixedIncomeTransaction = {
    id: '53000000-0000-4000-8000-000000000001',
    type: 'income',
    amountMinor: 100,
    currency: 'HKD',
    accountId: account.id,
    categoryId: incomeCategory.id,
    occurredOn: `${month}-15`,
    cleared: false,
    payee: 'Mixed bulk category guard',
    note: '',
  }
  const createdMixedIncome = await api(baseUrl, '/api/transactions', {
    method: 'POST',
    body: mixedIncomeTransaction,
  })
  assert.equal(createdMixedIncome.response.status, 201)
  const cashFlowWithMixedIncome = await api(baseUrl, `/api/summary?month=${month}`)
  const cashFlowWithMixedIncomePoint = cashFlowWithMixedIncome.payload.data.cashFlowTrend.at(-1)
  assert(cashFlowWithMixedIncomePoint)
  assert.deepEqual(cashFlowWithMixedIncomePoint, {
    ...cashFlowBeforeMixedPoint,
    incomeMinor: cashFlowBeforeMixedPoint.incomeMinor + mixedIncomeTransaction.amountMinor,
    netMinor: cashFlowBeforeMixedPoint.netMinor + mixedIncomeTransaction.amountMinor,
    transactionCount: cashFlowBeforeMixedPoint.transactionCount + 1,
  })
  const partiallyCompatibleBulkCategory = await api(baseUrl, '/api/transactions/category', {
    method: 'PATCH',
    body: {
      categoryId: expenseCategory.id,
      transactions: [
        bulkCategoryVersions[0],
        { id: mixedIncomeTransaction.id, updatedAt: createdMixedIncome.payload.data.updatedAt },
      ],
    },
  })
  assert.equal(partiallyCompatibleBulkCategory.response.status, 400)
  assert.equal(partiallyCompatibleBulkCategory.payload.error.code, 'CATEGORY_TYPE_MISMATCH')
  const bulkExpenseAfterMixedGuard = await api(baseUrl, `/api/transactions/${bulkClearingIds[0]}`)
  const bulkIncomeAfterMixedGuard = await api(baseUrl, `/api/transactions/${mixedIncomeTransaction.id}`)
  assert.equal(bulkExpenseAfterMixedGuard.payload.data.categoryId, 3)
  assert.equal(bulkIncomeAfterMixedGuard.payload.data.categoryId, incomeCategory.id)
  const deletedMixedIncome = await api(baseUrl, `/api/transactions/${mixedIncomeTransaction.id}`, {
    method: 'DELETE',
    body: { updatedAt: bulkIncomeAfterMixedGuard.payload.data.updatedAt },
  })
  assert.equal(deletedMixedIncome.response.status, 200)
  const cashFlowAfterMixedDelete = await api(baseUrl, `/api/summary?month=${month}`)
  assert.deepEqual(
    cashFlowAfterMixedDelete.payload.data.cashFlowTrend.at(-1),
    cashFlowBeforeMixedPoint,
  )

  const recategorizedBulk = await api(baseUrl, '/api/transactions/category', {
    method: 'PATCH',
    body: { categoryId: expenseCategory.id, transactions: bulkCategoryVersions },
  })
  assert.equal(recategorizedBulk.response.status, 200, JSON.stringify(recategorizedBulk.payload))
  assert.deepEqual(recategorizedBulk.payload.data, { updated: 2, categoryId: expenseCategory.id })
  const bulkCategoryAfter = await Promise.all(
    bulkClearingIds.map((id) => api(baseUrl, `/api/transactions/${id}`)),
  )
  assert(bulkCategoryAfter.every(({ payload }) => payload.data.categoryId === expenseCategory.id))
  const currentBulkCategoryVersions = bulkCategoryAfter.map(({ payload }) => ({
    id: payload.data.id,
    updatedAt: payload.data.updatedAt,
  }))
  const staleBulkCategory = await api(baseUrl, '/api/transactions/category', {
    method: 'PATCH',
    body: {
      categoryId: 3,
      transactions: [bulkCategoryVersions[0], currentBulkCategoryVersions[1]],
    },
  })
  assert.equal(staleBulkCategory.response.status, 409)
  assert.equal(staleBulkCategory.payload.error.code, 'TRANSACTION_VERSION_CONFLICT')
  const bulkCategoryAfterConflict = await Promise.all(
    bulkClearingIds.map((id) => api(baseUrl, `/api/transactions/${id}`)),
  )
  assert(bulkCategoryAfterConflict.every(({ payload }) => payload.data.categoryId === expenseCategory.id))

  const restoredBulkCategory = await api(baseUrl, '/api/transactions/category', {
    method: 'PATCH',
    body: {
      categoryId: 3,
      transactions: bulkCategoryAfterConflict.map(({ payload }) => ({
        id: payload.data.id,
        updatedAt: payload.data.updatedAt,
      })),
    },
  })
  assert.equal(restoredBulkCategory.response.status, 200)
  assert.deepEqual(restoredBulkCategory.payload.data, { updated: 2, categoryId: 3 })

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
    exactMatch: '41000000-0000-4000-8000-000000000006',
    ambiguousMatch: '41000000-0000-4000-8000-000000000007',
    categoryCorrection: '41000000-0000-4000-8000-000000000008',
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
      id: csvImportIds.exactMatch,
      cleared: true,
      sourceRow: 4,
      importKey: `csv:bank:id:${'c'.repeat(64)}`,
      include: true,
    },
    {
      ...transactionBody,
      id: csvImportIds.possibleDuplicate,
      sourceRow: 5,
      importKey: `csv:bank:id:${'b'.repeat(64)}`,
      include: false,
    },
    {
      ...transactionBody,
      id: csvImportIds.invalidAccount,
      accountId: 999_999,
      sourceRow: 6,
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
    'match_ready',
    'possible_duplicate',
    'account_invalid',
  ])
  assert.deepEqual(
    {
      ready: csvPreview.payload.data.ready,
      matchable: csvPreview.payload.data.matchable,
      possibleDuplicates: csvPreview.payload.data.possibleDuplicates,
      skipped: csvPreview.payload.data.skipped,
      blocked: csvPreview.payload.data.blocked,
    },
    { ready: 1, matchable: 1, possibleDuplicates: 1, skipped: 0, blocked: 2 },
  )

  const bankCategoryCandidate = {
    ...transactionBody,
    id: csvImportIds.categoryCorrection,
    sourceRow: 10,
    importKey: `csv:bank:id:${'e'.repeat(64)}`,
    include: true,
  }
  const bankCategoryCandidatePreview = await api(baseUrl, '/api/imports/csv', {
    method: 'POST',
    body: { mode: 'preview', rows: [bankCategoryCandidate] },
  })
  assert.equal(
    bankCategoryCandidatePreview.response.status,
    200,
    JSON.stringify(bankCategoryCandidatePreview.payload),
  )
  assert.equal(bankCategoryCandidatePreview.payload.data.rows[0].status, 'possible_duplicate')

  const correctedBankCategoryRow = {
    ...bankCategoryCandidate,
    categoryId: csvCorrectionCategory.id,
  }
  const correctedBankCategoryPreview = await api(baseUrl, '/api/imports/csv', {
    method: 'POST',
    body: { mode: 'preview', rows: [correctedBankCategoryRow] },
  })
  assert.equal(
    correctedBankCategoryPreview.response.status,
    200,
    JSON.stringify(correctedBankCategoryPreview.payload),
  )
  assert.equal(correctedBankCategoryPreview.payload.data.rows[0].status, 'new')
  assert.equal(correctedBankCategoryRow.importKey, bankCategoryCandidate.importKey)

  const correctedBankCategoryCommit = await api(baseUrl, '/api/imports/csv', {
    method: 'POST',
    body: { mode: 'commit', rows: [correctedBankCategoryRow] },
  })
  assert.equal(
    correctedBankCategoryCommit.response.status,
    201,
    JSON.stringify(correctedBankCategoryCommit.payload),
  )
  assert.equal(correctedBankCategoryCommit.payload.data.imported, 1)
  const importedBankCategoryTransaction = await api(
    baseUrl,
    `/api/transactions/${csvImportIds.categoryCorrection}`,
  )
  assert.equal(importedBankCategoryTransaction.response.status, 200)
  assert.equal(importedBankCategoryTransaction.payload.data.categoryId, csvCorrectionCategory.id)
  const deletedBankCategoryTransaction = await api(
    baseUrl,
    `/api/transactions/${csvImportIds.categoryCorrection}`,
    {
      method: 'DELETE',
      body: { updatedAt: importedBankCategoryTransaction.payload.data.updatedAt },
    },
  )
  assert.equal(deletedBankCategoryTransaction.response.status, 200)
  const bankCategoryAfterDelete = await api(baseUrl, '/api/imports/csv', {
    method: 'POST',
    body: { mode: 'preview', rows: [correctedBankCategoryRow] },
  })
  assert.equal(bankCategoryAfterDelete.payload.data.rows[0].status, 'already_imported')

  const csvCommit = await api(baseUrl, '/api/imports/csv', {
    method: 'POST',
    body: { mode: 'commit', rows: csvImportRows },
  })
  assert.equal(csvCommit.response.status, 201, JSON.stringify(csvCommit.payload))
  assert.equal(csvCommit.payload.data.imported, 1)
  assert.equal(csvCommit.payload.data.matched, 1)
  assert.equal(csvCommit.payload.data.staleSkipped, 0)

  const matchedManualTransaction = await api(baseUrl, `/api/transactions/${transactionBody.id}`)
  assert.equal(matchedManualTransaction.response.status, 200)
  assert.equal(matchedManualTransaction.payload.data.cleared, true)
  const absentMatchedImportTransaction = await api(
    baseUrl,
    `/api/transactions/${csvImportIds.exactMatch}`,
  )
  assert.equal(absentMatchedImportTransaction.response.status, 404)

  const csvRepreview = await api(baseUrl, '/api/imports/csv', {
    method: 'POST',
    body: { mode: 'preview', rows: csvImportRows.map((row) => ({ ...row, include: false })) },
  })
  assert.equal(csvRepreview.payload.data.rows[0].status, 'already_imported')
  assert.equal(csvRepreview.payload.data.rows[2].status, 'already_imported')

  const importedCsvTransaction = await api(baseUrl, `/api/transactions/${csvImportIds.fresh}`)
  assert.equal(importedCsvTransaction.response.status, 200)
  assert.equal(importedCsvTransaction.payload.data.categoryId, transactionBody.categoryId)
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
    include: index === 3,
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

  const ambiguousMatchPreview = await api(baseUrl, '/api/imports/csv', {
    method: 'POST',
    body: {
      mode: 'preview',
      rows: [{
        ...transactionBody,
        id: csvImportIds.ambiguousMatch,
        cleared: true,
        sourceRow: 7,
        importKey: `csv:bank:id:${'d'.repeat(64)}`,
        include: false,
      }],
    },
  })
  assert.equal(ambiguousMatchPreview.response.status, 200)
  assert.equal(ambiguousMatchPreview.payload.data.rows[0].status, 'possible_duplicate')
  assert.equal(ambiguousMatchPreview.payload.data.matchable, 0)
  assert.equal(ambiguousMatchPreview.payload.data.possibleDuplicates, 1)

  const duplicateReview = await api(
    baseUrl,
    `/api/transactions?month=${month}&search=integration%20test&duplicates=exact`,
  )
  assert.equal(duplicateReview.response.status, 200, JSON.stringify(duplicateReview.payload))
  assert.deepEqual(
    new Set(duplicateReview.payload.data.map(({ id }) => id)),
    new Set([transactionBody.id, csvImportIds.possibleDuplicate]),
  )
  assert(duplicateReview.payload.data.some(({ cleared }) => cleared))
  assert(duplicateReview.payload.data.some(({ cleared }) => !cleared))

  const duplicateReviewSummary = await api(
    baseUrl,
    `/api/transactions/summary?month=${month}&search=integration%20test&duplicates=exact`,
  )
  assert.equal(duplicateReviewSummary.response.status, 200)
  assert.deepEqual(duplicateReviewSummary.payload.data, {
    transactionCount: 2,
    income: 0,
    expense: transactionBody.amountMinor * 2,
    net: transactionBody.amountMinor * -2,
  })

  const duplicateReviewExport = await exportTransactionCsv(baseUrl, {
    month,
    search: 'integration test',
    duplicates: 'exact',
  })
  assert.equal(duplicateReviewExport.response.status, 200)
  assert.equal(duplicateReviewExport.payload.trimEnd().split('\r\n').length - 1, 2)

  const invalidDuplicateReview = await api(
    baseUrl,
    `/api/transactions?month=${month}&duplicates=fuzzy`,
  )
  assert.equal(invalidDuplicateReview.response.status, 400)
  assert.equal(invalidDuplicateReview.payload.error.code, 'INVALID_QUERY')

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
    sourceRow: 8 + index,
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
      updatedAt: matchedManualTransaction.payload.data.updatedAt,
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

  const filteredCsvExport = await exportTransactionCsv(baseUrl, {
    month,
    type: 'expense',
    search: 'edited integration test',
  })
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
    yearly: '20000000-0000-4000-8000-000000000011',
    cron: '20000000-0000-4000-8000-000000000004',
    race: '20000000-0000-4000-8000-000000000007',
    income: '20000000-0000-4000-8000-000000000010',
    skip: '20000000-0000-4000-8000-000000000009',
    finite: '20000000-0000-4000-8000-000000000012',
    finiteSkip: '20000000-0000-4000-8000-000000000013',
  }
  const tomorrow = shiftCalendarDay(today, 1)
  const dayAfterTomorrow = shiftCalendarDay(today, 2)
  const nextYear = shiftCalendarYear(today, 1)
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

  const endBeforeStart = await api(baseUrl, '/api/recurring-rules', {
    method: 'POST',
    body: {
      ...baseRule,
      id: '20000000-0000-4000-8000-000000000014',
      frequency: 'daily',
      scheduleEndsOn: shiftCalendarDay(today, -1),
    },
  })
  assert.equal(endBeforeStart.response.status, 400)
  assert.equal(endBeforeStart.payload.error.code, 'VALIDATION_ERROR')

  const endBeforeFirstOccurrence = await api(baseUrl, '/api/recurring-rules', {
    method: 'POST',
    body: {
      ...baseRule,
      id: '20000000-0000-4000-8000-000000000015',
      frequency: 'daily',
      firstOccurrenceOn: tomorrow,
      scheduleEndsOn: today,
    },
  })
  assert.equal(endBeforeFirstOccurrence.response.status, 400)
  assert.equal(endBeforeFirstOccurrence.payload.error.code, 'VALIDATION_ERROR')

  const createdRules = []
  for (const frequency of ['daily', 'weekly', 'monthly', 'yearly']) {
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
    assert.equal(created.payload.data.scheduleEndsOn, null)
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
  assert.equal(skipped.payload.data.nextOccurrenceOn, tomorrow)
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
  assert.equal(edited.payload.data.scheduleEndsOn, null)
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

  const forecastIncome = await api(baseUrl, '/api/recurring-rules', {
    method: 'POST',
    body: {
      ...baseRule,
      id: ruleIds.income,
      name: 'income integration',
      type: 'income',
      categoryId: incomeCategory.id,
      frequency: 'monthly',
      payee: 'integration employer',
    },
  })
  assert.equal(forecastIncome.response.status, 201)

  const forecastBeforeRun = await api(baseUrl, `/api/summary?month=${month}`)
  assert.equal(forecastBeforeRun.response.status, 200)
  const forecastByRule = new Map(forecastBeforeRun.payload.data.recurringForecast.map(
    (item) => [item.recurringRuleId, item],
  ))
  assert.deepEqual(forecastByRule.get(ruleIds.income), {
    recurringRuleId: ruleIds.income,
    name: 'income integration',
    type: 'income',
    amountMinor: 456,
    payee: 'integration employer',
    accountId: account.id,
    categoryId: incomeCategory.id,
    frequency: 'monthly',
    firstOccurrenceOn: today,
    occurrenceCount: 1,
    occurrenceDates: [today],
  })
  assert.equal(forecastByRule.get(ruleIds.daily).occurrenceDates[0], today)
  assert.equal(
    forecastByRule.get(ruleIds.daily).occurrenceDates.length,
    forecastByRule.get(ruleIds.daily).occurrenceCount,
  )
  assert.equal(forecastByRule.get(ruleIds.weekly).occurrenceDates[0], today)
  assert.deepEqual(forecastByRule.get(ruleIds.yearly), {
    recurringRuleId: ruleIds.yearly,
    name: 'yearly integration',
    type: 'expense',
    amountMinor: 456,
    payee: 'integration test',
    accountId: account.id,
    categoryId: expenseCategory.id,
    frequency: 'yearly',
    firstOccurrenceOn: today,
    occurrenceCount: 1,
    occurrenceDates: [today],
  })
  const forecastBeforeRunTomorrow = await api(
    baseUrl,
    `/api/summary?month=${tomorrow.slice(0, 7)}`,
  )
  assert.equal(forecastBeforeRunTomorrow.response.status, 200)
  assert.equal(
    forecastBeforeRunTomorrow.payload.data.recurringForecast.find(
      ({ recurringRuleId }) => recurringRuleId === ruleIds.skip,
    ).occurrenceDates[0],
    tomorrow,
  )

  const removedForecastIncome = await api(baseUrl, `/api/recurring-rules/${ruleIds.income}`, {
    method: 'DELETE',
    body: { revision: forecastIncome.payload.data.revision },
  })
  assert.equal(removedForecastIncome.response.status, 200)

  const firstRun = await api(baseUrl, '/api/recurring-rules/run-due', {
    method: 'POST',
    body: { asOf: today },
  })
  assert.equal(firstRun.response.status, 200)
  assert.equal(firstRun.payload.data.created, 4)
  assert.equal(firstRun.payload.data.failed, 0)
  const secondRun = await api(baseUrl, '/api/recurring-rules/run-due', {
    method: 'POST',
    body: { asOf: today },
  })
  assert.equal(secondRun.response.status, 200)
  assert.equal(secondRun.payload.data.created, 0)

  const forecastAfterRun = await api(baseUrl, `/api/summary?month=${month}`)
  assert.equal(forecastAfterRun.response.status, 200)
  assert.equal(
    forecastAfterRun.payload.data.recurringForecast.some(
      ({ occurrenceDates }) => occurrenceDates.includes(today),
    ),
    false,
  )
  const forecastForNextOccurrence = await api(
    baseUrl,
    `/api/summary?month=${tomorrow.slice(0, 7)}`,
  )
  assert.equal(forecastForNextOccurrence.response.status, 200)
  assert.equal(
    forecastForNextOccurrence.payload.data.recurringForecast.find(
      ({ recurringRuleId }) => recurringRuleId === ruleIds.daily,
    ).occurrenceDates[0],
    tomorrow,
  )
  const yearlyRuleAfterRun = await api(baseUrl, `/api/recurring-rules/${ruleIds.yearly}`)
  assert.equal(yearlyRuleAfterRun.response.status, 200)
  assert.equal(yearlyRuleAfterRun.payload.data.lastOccurrenceOn, today)
  assert.equal(yearlyRuleAfterRun.payload.data.nextOccurrenceOn, nextYear)
  assert.equal(yearlyRuleAfterRun.payload.data.generatedCount, 1)
  const yearlyForecastAfterRun = await api(
    baseUrl,
    `/api/summary?month=${nextYear.slice(0, 7)}`,
  )
  assert.equal(yearlyForecastAfterRun.response.status, 200)
  assert.deepEqual(
    yearlyForecastAfterRun.payload.data.recurringForecast.find(
      ({ recurringRuleId }) => recurringRuleId === ruleIds.yearly,
    ).occurrenceDates,
    [nextYear],
  )

  const finiteAccount = await api(baseUrl, '/api/accounts', {
    method: 'POST',
    body: { name: 'Finite recurring account', type: 'bank' },
  })
  assert.equal(finiteAccount.response.status, 201, JSON.stringify(finiteAccount.payload))
  const finiteCategory = await api(baseUrl, '/api/categories', {
    method: 'POST',
    body: { name: 'Finite recurring category', type: 'expense' },
  })
  assert.equal(finiteCategory.response.status, 201, JSON.stringify(finiteCategory.payload))
  const finiteBaseRule = {
    ...baseRule,
    accountId: finiteAccount.payload.data.id,
    categoryId: finiteCategory.payload.data.id,
    frequency: 'daily',
    payee: 'finite schedule integration',
  }

  const finiteSkipRule = await api(baseUrl, '/api/recurring-rules', {
    method: 'POST',
    body: {
      ...finiteBaseRule,
      id: ruleIds.finiteSkip,
      name: 'finite skip integration',
      scheduleEndsOn: today,
    },
  })
  assert.equal(finiteSkipRule.response.status, 201, JSON.stringify(finiteSkipRule.payload))
  assert.equal(finiteSkipRule.payload.data.scheduleEndsOn, today)
  const skippedFiniteEnd = await api(
    baseUrl,
    `/api/recurring-rules/${ruleIds.finiteSkip}/skip`,
    {
      method: 'POST',
      body: {
        revision: finiteSkipRule.payload.data.revision,
        nextOccurrenceOn: today,
      },
    },
  )
  assert.equal(skippedFiniteEnd.response.status, 200, JSON.stringify(skippedFiniteEnd.payload))
  assert.equal(skippedFiniteEnd.payload.data.nextOccurrenceOn, tomorrow)
  assert.equal(skippedFiniteEnd.payload.data.isActive, false)
  assert.equal(skippedFiniteEnd.payload.data.generatedCount, 0)

  const finiteRule = await api(baseUrl, '/api/recurring-rules', {
    method: 'POST',
    body: {
      ...finiteBaseRule,
      id: ruleIds.finite,
      name: 'finite run integration',
      scheduleEndsOn: tomorrow,
    },
  })
  assert.equal(finiteRule.response.status, 201, JSON.stringify(finiteRule.payload))
  assert.equal(finiteRule.payload.data.scheduleEndsOn, tomorrow)
  const incompatibleLegacyFiniteUpdate = await api(
    baseUrl,
    `/api/recurring-rules/${ruleIds.finite}`,
    {
      method: 'PUT',
      body: {
        ...finiteBaseRule,
        scheduleStartsOn: dayAfterTomorrow,
        name: 'incompatible legacy finite update',
        revision: finiteRule.payload.data.revision,
      },
    },
  )
  assert.equal(
    incompatibleLegacyFiniteUpdate.response.status,
    409,
    JSON.stringify(incompatibleLegacyFiniteUpdate.payload),
  )
  assert.equal(incompatibleLegacyFiniteUpdate.payload.error.code, 'RULE_VERSION_CONFLICT')
  const legacyFiniteUpdate = await api(baseUrl, `/api/recurring-rules/${ruleIds.finite}`, {
    method: 'PUT',
    body: {
      ...finiteBaseRule,
      name: 'legacy finite update',
      revision: finiteRule.payload.data.revision,
    },
  })
  assert.equal(legacyFiniteUpdate.response.status, 200, JSON.stringify(legacyFiniteUpdate.payload))
  assert.equal(legacyFiniteUpdate.payload.data.scheduleEndsOn, tomorrow)

  const forecastMonths = [...new Set([month, tomorrow.slice(0, 7)])]
  const finiteForecastDates = new Set()
  for (const forecastMonth of forecastMonths) {
    const finiteForecast = await api(baseUrl, `/api/summary?month=${forecastMonth}`)
    assert.equal(finiteForecast.response.status, 200)
    const forecast = finiteForecast.payload.data.recurringForecast.find(
      ({ recurringRuleId }) => recurringRuleId === ruleIds.finite,
    )
    for (const occurrenceOn of forecast?.occurrenceDates ?? []) {
      finiteForecastDates.add(occurrenceOn)
    }
  }
  assert.deepEqual([...finiteForecastDates].sort(), [today, tomorrow])

  const finiteRun = await api(baseUrl, '/api/recurring-rules/run-due', {
    method: 'POST',
    body: { asOf: tomorrow },
  })
  assert.equal(finiteRun.response.status, 200, JSON.stringify(finiteRun.payload))
  assert(finiteRun.payload.data.created >= 2)
  const completedFiniteRule = await api(baseUrl, `/api/recurring-rules/${ruleIds.finite}`)
  assert.equal(completedFiniteRule.response.status, 200)
  assert.equal(completedFiniteRule.payload.data.scheduleEndsOn, tomorrow)
  assert.equal(completedFiniteRule.payload.data.nextOccurrenceOn, dayAfterTomorrow)
  assert.equal(completedFiniteRule.payload.data.isActive, false)
  assert.equal(completedFiniteRule.payload.data.generatedCount, 2)

  const attemptedCompletedResume = await api(
    baseUrl,
    `/api/recurring-rules/${ruleIds.finite}/status`,
    {
      method: 'PATCH',
      body: { isActive: true, revision: completedFiniteRule.payload.data.revision },
    },
  )
  assert.equal(attemptedCompletedResume.response.status, 200)
  assert.equal(attemptedCompletedResume.payload.data.isActive, false)
  assert.equal(attemptedCompletedResume.payload.data.nextOccurrenceOn, dayAfterTomorrow)

  const futureFiniteRun = await api(baseUrl, '/api/recurring-rules/run-due', {
    method: 'POST',
    body: { asOf: dayAfterTomorrow },
  })
  assert.equal(futureFiniteRun.response.status, 200, JSON.stringify(futureFiniteRun.payload))
  const finiteTransactions = await api(
    baseUrl,
    `/api/transactions?month=${month}&scope=range&dateFrom=${today}&dateTo=${dayAfterTomorrow}&search=finite%20schedule%20integration`,
  )
  assert.equal(finiteTransactions.response.status, 200)
  assert.deepEqual(
    finiteTransactions.payload.data
      .filter(({ recurringRuleId }) => recurringRuleId === ruleIds.finite)
      .map(({ recurrenceDueOn }) => recurrenceDueOn)
      .sort(),
    [today, tomorrow],
  )
  assert.equal(
    finiteTransactions.payload.data.some(
      ({ recurringRuleId }) => recurringRuleId === ruleIds.finiteSkip,
    ),
    false,
  )
  for (const forecastMonth of forecastMonths) {
    const completedForecast = await api(baseUrl, `/api/summary?month=${forecastMonth}`)
    assert.equal(completedForecast.response.status, 200)
    assert.equal(
      completedForecast.payload.data.recurringForecast.some(
        ({ recurringRuleId }) => recurringRuleId === ruleIds.finite,
      ),
      false,
    )
  }

  const disabledFiniteAccount = await api(
    baseUrl,
    `/api/accounts/${finiteAccount.payload.data.id}`,
    {
      method: 'PATCH',
      body: { isActive: false, updatedAt: finiteAccount.payload.data.updatedAt },
    },
  )
  assert.equal(disabledFiniteAccount.response.status, 200, JSON.stringify(disabledFiniteAccount.payload))
  const disabledFiniteCategory = await api(
    baseUrl,
    `/api/categories/${finiteCategory.payload.data.id}`,
    {
      method: 'PATCH',
      body: { isActive: false, updatedAt: finiteCategory.payload.data.updatedAt },
    },
  )
  assert.equal(disabledFiniteCategory.response.status, 200, JSON.stringify(disabledFiniteCategory.payload))

  const beforeDelete = await api(baseUrl, `/api/transactions?month=${month}`)
  assert.equal(beforeDelete.response.status, 200)
  const initialDueRuleIds = new Set([
    ruleIds.daily,
    ruleIds.weekly,
    ruleIds.monthly,
    ruleIds.yearly,
  ])
  assert.equal(
    beforeDelete.payload.data.filter(
      (item) => item.recurrenceDueOn === today && initialDueRuleIds.has(item.recurringRuleId),
    ).length,
    4,
  )
  assert.equal(beforeDelete.payload.data.some(
    (item) => item.recurringRuleId === ruleIds.skip && item.recurrenceDueOn === today,
  ), false)
  assert.equal(
    beforeDelete.payload.data.filter((item) => item.recurringRuleId === ruleIds.yearly).length,
    1,
  )
  assert(
    beforeDelete.payload.data
      .filter(
        (item) => item.recurrenceDueOn === today && initialDueRuleIds.has(item.recurringRuleId),
      )
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

  const recurringTransfers = await verifyRecurringTransferRules(baseUrl, today, month)

  const navigationBackupDownload = await api(baseUrl, '/api/backups/ledger')
  assert.equal(navigationBackupDownload.response.status, 404)
  assert.equal(navigationBackupDownload.payload.error.code, 'NOT_FOUND')

  const crossOriginBackupDownload = await downloadLedgerBackup(baseUrl, {
    origin: 'https://attacker.invalid',
  })
  assert.equal(crossOriginBackupDownload.response.status, 403)
  assert.equal(crossOriginBackupDownload.payload.error.code, 'ORIGIN_FORBIDDEN')

  const backupDownload = await downloadLedgerBackup(baseUrl)
  assert.equal(backupDownload.response.status, 200)
  assert.match(backupDownload.response.headers.get('cache-control') ?? '', /no-store/)
  assert.match(backupDownload.response.headers.get('content-disposition') ?? '', /hushledger-ledger-.*\.json/)
  const backup = backupDownload.payload
  assert.equal(backup.format, 'hushledger-ledger-backup')
  assert.equal(backup.version, 1)
  assert.equal(backup.schemaVersion, 17)
  assert.equal(backup.data.currency, 'HKD')
  assert.match(backup.checksum.digest, /^[0-9a-f]{64}$/)
  assert(backup.data.transactions.length > 200)
  assert(backup.data.transactions.every(({ cleared }) => typeof cleared === 'boolean'))
  assert(backup.data.categories.every(({ monthlyPlanMinor }) => (
    monthlyPlanMinor === null || Number.isSafeInteger(monthlyPlanMinor)
  )))
  assert(backup.data.accounts.every(({ openingBalanceMinor, openingBalanceOn }) => (
    (openingBalanceMinor === null && openingBalanceOn === null)
    || (Number.isSafeInteger(openingBalanceMinor) && typeof openingBalanceOn === 'string')
  )))
  assert(backup.data.accounts.some(({ openingBalanceMinor, openingBalanceOn }) => (
    openingBalanceMinor === 100_000 && openingBalanceOn === today
  )))
  assert.equal(backup.data.accountTransfers.length, 4)
  const manualBackupTransfer = backup.data.accountTransfers.find(({ id }) => id === transferBody.id)
  assert(manualBackupTransfer)
  assert.equal(manualBackupTransfer.fromCleared, true)
  assert.equal(manualBackupTransfer.toCleared, true)
  assert.equal(manualBackupTransfer.recurringTransferRuleId, null)
  assert.equal(manualBackupTransfer.recurringTransferRuleName, null)
  assert.equal(manualBackupTransfer.recurrenceDueOn, null)
  assert.equal(manualBackupTransfer.recurringOccurrenceKey, null)
  const historicalBackupTransfer = backup.data.accountTransfers.find(
    ({ id }) => id === recurringTransfers.historicalTransfer.id,
  )
  assert(historicalBackupTransfer)
  assert.equal(historicalBackupTransfer.amountMinor, recurringTransfers.historicalTransfer.amountMinor)
  assert.equal(historicalBackupTransfer.fromAccountId, recurringTransfers.historicalTransfer.fromAccountId)
  assert.equal(historicalBackupTransfer.toAccountId, recurringTransfers.historicalTransfer.toAccountId)
  assert.equal(historicalBackupTransfer.occurredOn, recurringTransfers.historicalTransfer.occurredOn)
  assert.equal(historicalBackupTransfer.fromCleared, true)
  assert.equal(historicalBackupTransfer.toCleared, true)
  assert.equal(historicalBackupTransfer.recurringTransferRuleId, recurringTransfers.ruleIds.main)
  assert.equal(
    historicalBackupTransfer.recurringTransferRuleName,
    recurringTransfers.historicalTransfer.recurringTransferRuleName,
  )
  assert.equal(historicalBackupTransfer.recurrenceDueOn, today)
  assert.equal(
    historicalBackupTransfer.recurringOccurrenceKey,
    `${recurringTransfers.ruleIds.main}:${today}`,
  )
  assert.deepEqual(
    backup.data.accountTransfers
      .filter(({ id }) => recurringTransfers.generatedTransferIds.includes(id))
      .map(({ recurringTransferRuleId }) => recurringTransferRuleId)
      .sort(),
    [
      recurringTransfers.ruleIds.cron,
      recurringTransfers.ruleIds.main,
      recurringTransfers.ruleIds.race,
    ].sort(),
  )
  const historicalRuleSnapshot = backup.data.recurringTransferRules.find(
    ({ id }) => id === recurringTransfers.ruleIds.main,
  )
  assert(historicalRuleSnapshot)
  assert.equal(historicalRuleSnapshot.name, 'Future savings plan changed after history')
  assert.equal(historicalRuleSnapshot.amountMinor, 22_000)
  assert.equal(historicalRuleSnapshot.frequency, 'weekly')
  assert.equal(historicalRuleSnapshot.isActive, false)
  assert.match(historicalRuleSnapshot.deletedAt, /Z$/)
  assert.notEqual(
    historicalRuleSnapshot.name,
    historicalBackupTransfer.recurringTransferRuleName,
  )
  assert.equal(backup.data.emergencyFundGoals.length, 1)
  assert.equal(backup.data.emergencyFundGoals[0].id, 1)
  assert.equal(
    backup.data.emergencyFundGoals[0].accountId,
    emergencyFundGoal.payload.data.accountId,
  )
  assert.equal(backup.data.emergencyFundGoals[0].targetMinor, 900_000)
  assert.equal(
    backup.data.emergencyFundGoals[0].updatedAt,
    emergencyFundGoal.payload.data.updatedAt,
  )
  assert(backup.data.transactionImportKeys.length > 0)
  assert.equal(
    backup.data.recurringRules.find(({ id }) => id === ruleIds.finite)?.scheduleEndsOn,
    tomorrow,
  )
  assert.equal(
    backup.data.recurringRules.find(({ id }) => id === ruleIds.finiteSkip)?.scheduleEndsOn,
    today,
  )
  assert(backup.data.recurringRules.every(({ scheduleEndsOn }) => (
    scheduleEndsOn === null || typeof scheduleEndsOn === 'string'
  )))

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
  assert.equal(originalPreview.payload.data.currentCurrency, 'HKD')
  assert.equal(originalPreview.payload.data.backupCurrency, 'HKD')
  assert.equal(originalPreview.payload.data.backupCounts.transactions, backup.data.transactions.length)
  assert.equal(
    originalPreview.payload.data.backupCounts.accountTransfers,
    backup.data.accountTransfers.length,
  )
  assert.equal(
    originalPreview.payload.data.backupCounts.recurringTransferRules,
    backup.data.recurringTransferRules.length,
  )
  assert.equal(originalPreview.payload.data.backupCounts.emergencyFundGoals, 1)
  assert.equal(originalPreview.payload.data.currentDigest, originalPreview.payload.data.backupDigest)

  const changedEmergencyFundGoal = await api(baseUrl, '/api/emergency-fund-goal', {
    method: 'PUT',
    body: {
      accountId: emergencyFundGoal.payload.data.accountId,
      targetMinor: 910_000,
      expectedUpdatedAt: emergencyFundGoal.payload.data.updatedAt,
    },
  })
  assert.equal(changedEmergencyFundGoal.response.status, 200)

  const staleGoalRestore = await api(baseUrl, '/api/backups/ledger', {
    method: 'POST',
    body: {
      mode: 'commit',
      backup,
      expectedCurrentDigest: originalPreview.payload.data.currentDigest,
      expectedRevision: originalPreview.payload.data.currentRevision,
      confirmation: 'RESTORE',
    },
  })
  assert.equal(staleGoalRestore.response.status, 409)
  assert.equal(staleGoalRestore.payload.error.code, 'BACKUP_PREVIEW_STALE')
  assert.equal((await api(baseUrl, '/api/emergency-fund-goal')).payload.data.targetMinor, 910_000)

  const goalMutationPreview = await api(baseUrl, '/api/backups/ledger', {
    method: 'POST',
    body: { mode: 'preview', backup },
  })
  assert.equal(goalMutationPreview.response.status, 200)
  assert(
    goalMutationPreview.payload.data.currentRevision
      > originalPreview.payload.data.currentRevision,
  )
  assert.notEqual(
    goalMutationPreview.payload.data.currentDigest,
    goalMutationPreview.payload.data.backupDigest,
  )

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
      expectedCurrentDigest: goalMutationPreview.payload.data.currentDigest,
      expectedRevision: goalMutationPreview.payload.data.currentRevision,
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
  assert(
    replacementPreview.payload.data.currentRevision
      > goalMutationPreview.payload.data.currentRevision,
  )
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
  const restoredEmergencyFundGoal = await api(baseUrl, '/api/emergency-fund-goal')
  const { id: restoredGoalId, ...expectedRestoredEmergencyFundGoal } = backup.data.emergencyFundGoals[0]
  assert.equal(restoredGoalId, 1)
  assert.deepEqual(restoredEmergencyFundGoal.payload.data, expectedRestoredEmergencyFundGoal)
  const restoredBackup = await downloadLedgerBackup(baseUrl)
  assert.deepEqual(restoredBackup.payload.data, backup.data)

  const schema16Backup = withoutRecurringTransferData(backup)
  schema16Backup.schemaVersion = 16
  schema16Backup.checksum.digest = backupChecksum(schema16Backup)
  const schema16Preview = await api(baseUrl, '/api/backups/ledger', {
    method: 'POST',
    body: { mode: 'preview', backup: schema16Backup },
  })
  assert.equal(schema16Preview.response.status, 200, JSON.stringify(schema16Preview.payload))
  const schema16Restore = await api(baseUrl, '/api/backups/ledger', {
    method: 'POST',
    body: {
      mode: 'commit',
      backup: schema16Backup,
      expectedCurrentDigest: schema16Preview.payload.data.currentDigest,
      expectedRevision: schema16Preview.payload.data.currentRevision,
      confirmation: 'RESTORE',
    },
  })
  assert.equal(schema16Restore.response.status, 200, JSON.stringify(schema16Restore.payload))
  const upgradedSchema16Backup = await downloadLedgerBackup(baseUrl)
  assert.equal(upgradedSchema16Backup.payload.schemaVersion, 17)
  assert.deepEqual(upgradedSchema16Backup.payload.data.recurringTransferRules, [])
  assert(upgradedSchema16Backup.payload.data.accountTransfers.every(({
    recurringTransferRuleId,
    recurringTransferRuleName,
    recurrenceDueOn,
    recurringOccurrenceKey,
  }) => (
    recurringTransferRuleId === null
    && recurringTransferRuleName === null
    && recurrenceDueOn === null
    && recurringOccurrenceKey === null
  )))

  const schema15Backup = withoutRecurringScheduleEnds(backup)
  schema15Backup.schemaVersion = 15
  schema15Backup.checksum.digest = backupChecksum(schema15Backup)
  const schema15Preview = await api(baseUrl, '/api/backups/ledger', {
    method: 'POST',
    body: { mode: 'preview', backup: schema15Backup },
  })
  assert.equal(schema15Preview.response.status, 200, JSON.stringify(schema15Preview.payload))
  const schema15Restore = await api(baseUrl, '/api/backups/ledger', {
    method: 'POST',
    body: {
      mode: 'commit',
      backup: schema15Backup,
      expectedCurrentDigest: schema15Preview.payload.data.currentDigest,
      expectedRevision: schema15Preview.payload.data.currentRevision,
      confirmation: 'RESTORE',
    },
  })
  assert.equal(schema15Restore.response.status, 200, JSON.stringify(schema15Restore.payload))
  const upgradedSchema15Backup = await downloadLedgerBackup(baseUrl)
  assert.equal(upgradedSchema15Backup.payload.schemaVersion, 17)
  assert(upgradedSchema15Backup.payload.data.recurringRules.every(
    ({ scheduleEndsOn }) => scheduleEndsOn === null,
  ))

  const schema14Backup = withoutYearlyRecurringData(backup)
  schema14Backup.schemaVersion = 14
  schema14Backup.checksum.digest = backupChecksum(schema14Backup)
  const schema14Preview = await api(baseUrl, '/api/backups/ledger', {
    method: 'POST',
    body: { mode: 'preview', backup: schema14Backup },
  })
  assert.equal(schema14Preview.response.status, 200, JSON.stringify(schema14Preview.payload))
  assert.equal(schema14Preview.payload.data.backupCurrency, 'HKD')

  const schema13Backup = withoutYearlyRecurringData(backup)
  schema13Backup.schemaVersion = 13
  delete schema13Backup.data.currency
  schema13Backup.checksum.digest = backupChecksum(schema13Backup)
  const schema13Preview = await api(baseUrl, '/api/backups/ledger', {
    method: 'POST',
    body: { mode: 'preview', backup: schema13Backup },
  })
  assert.equal(schema13Preview.response.status, 200, JSON.stringify(schema13Preview.payload))
  const schema13Restore = await api(baseUrl, '/api/backups/ledger', {
    method: 'POST',
    body: {
      mode: 'commit',
      backup: schema13Backup,
      expectedCurrentDigest: schema13Preview.payload.data.currentDigest,
      expectedRevision: schema13Preview.payload.data.currentRevision,
      confirmation: 'RESTORE',
    },
  })
  assert.equal(schema13Restore.response.status, 200, JSON.stringify(schema13Restore.payload))
  const upgradedSchema13Backup = await downloadLedgerBackup(baseUrl)
  assert.equal(upgradedSchema13Backup.payload.schemaVersion, 17)
  assert.equal(upgradedSchema13Backup.payload.data.currency, 'HKD')

  const schema12Backup = withoutYearlyRecurringData(backup)
  schema12Backup.schemaVersion = 12
  delete schema12Backup.data.currency
  delete schema12Backup.data.emergencyFundGoals
  schema12Backup.checksum.digest = backupChecksum(schema12Backup)
  const schema12Preview = await api(baseUrl, '/api/backups/ledger', {
    method: 'POST',
    body: { mode: 'preview', backup: schema12Backup },
  })
  assert.equal(schema12Preview.response.status, 200, JSON.stringify(schema12Preview.payload))
  assert.equal(schema12Preview.payload.data.backupCounts.emergencyFundGoals, 0)
  const schema12Restore = await api(baseUrl, '/api/backups/ledger', {
    method: 'POST',
    body: {
      mode: 'commit',
      backup: schema12Backup,
      expectedCurrentDigest: schema12Preview.payload.data.currentDigest,
      expectedRevision: schema12Preview.payload.data.currentRevision,
      confirmation: 'RESTORE',
    },
  })
  assert.equal(schema12Restore.response.status, 200, JSON.stringify(schema12Restore.payload))
  const upgradedSchema12Backup = await downloadLedgerBackup(baseUrl)
  assert.equal(upgradedSchema12Backup.payload.data.currency, 'HKD')
  assert.deepEqual(upgradedSchema12Backup.payload.data.emergencyFundGoals, [])

  const schema11Backup = withoutYearlyRecurringData(backup)
  schema11Backup.schemaVersion = 11
  delete schema11Backup.data.currency
  schema11Backup.data.accounts = withoutAccountOpeningBalances(schema11Backup.data.accounts)
  delete schema11Backup.data.emergencyFundGoals
  schema11Backup.checksum.digest = backupChecksum(schema11Backup)
  const schema11Preview = await api(baseUrl, '/api/backups/ledger', {
    method: 'POST',
    body: { mode: 'preview', backup: schema11Backup },
  })
  assert.equal(schema11Preview.response.status, 200, JSON.stringify(schema11Preview.payload))
  assert.equal(
    schema11Preview.payload.data.backupCounts.accountTransfers,
    backup.data.accountTransfers.length,
  )
  assert.equal(schema11Preview.payload.data.backupCounts.emergencyFundGoals, 0)
  const schema11Restore = await api(baseUrl, '/api/backups/ledger', {
    method: 'POST',
    body: {
      mode: 'commit',
      backup: schema11Backup,
      expectedCurrentDigest: schema11Preview.payload.data.currentDigest,
      expectedRevision: schema11Preview.payload.data.currentRevision,
      confirmation: 'RESTORE',
    },
  })
  assert.equal(schema11Restore.response.status, 200, JSON.stringify(schema11Restore.payload))
  const upgradedSchema11Backup = await downloadLedgerBackup(baseUrl)
  assert.equal(upgradedSchema11Backup.payload.data.currency, 'HKD')
  assert.equal(
    upgradedSchema11Backup.payload.data.accountTransfers.length,
    backup.data.accountTransfers.length,
  )
  assert.deepEqual(upgradedSchema11Backup.payload.data.emergencyFundGoals, [])
  assert(upgradedSchema11Backup.payload.data.accounts.every(({
    openingBalanceMinor,
    openingBalanceOn,
  }) => openingBalanceMinor === null && openingBalanceOn === null))

  const schema10Backup = withoutYearlyRecurringData(backup)
  schema10Backup.schemaVersion = 10
  delete schema10Backup.data.currency
  schema10Backup.data.accounts = withoutAccountOpeningBalances(schema10Backup.data.accounts)
  delete schema10Backup.data.accountTransfers
  delete schema10Backup.data.emergencyFundGoals
  schema10Backup.checksum.digest = backupChecksum(schema10Backup)
  const schema10Preview = await api(baseUrl, '/api/backups/ledger', {
    method: 'POST',
    body: { mode: 'preview', backup: schema10Backup },
  })
  assert.equal(schema10Preview.response.status, 200, JSON.stringify(schema10Preview.payload))
  assert.equal(schema10Preview.payload.data.backupCounts.accountTransfers, 0)
  assert.equal(schema10Preview.payload.data.backupCounts.emergencyFundGoals, 0)
  const schema10Restore = await api(baseUrl, '/api/backups/ledger', {
    method: 'POST',
    body: {
      mode: 'commit',
      backup: schema10Backup,
      expectedCurrentDigest: schema10Preview.payload.data.currentDigest,
      expectedRevision: schema10Preview.payload.data.currentRevision,
      confirmation: 'RESTORE',
    },
  })
  assert.equal(schema10Restore.response.status, 200, JSON.stringify(schema10Restore.payload))
  const upgradedSchema10Backup = await downloadLedgerBackup(baseUrl)
  assert.equal(upgradedSchema10Backup.payload.data.currency, 'HKD')
  assert.deepEqual(upgradedSchema10Backup.payload.data.accountTransfers, [])
  assert.deepEqual(upgradedSchema10Backup.payload.data.emergencyFundGoals, [])
  assert(upgradedSchema10Backup.payload.data.categories.some(
    ({ monthlyPlanMinor }) => monthlyPlanMinor !== null,
  ))

  const schema9Backup = withoutYearlyRecurringData(backup)
  schema9Backup.schemaVersion = 9
  delete schema9Backup.data.currency
  schema9Backup.data.accounts = withoutAccountOpeningBalances(schema9Backup.data.accounts)
  delete schema9Backup.data.accountTransfers
  delete schema9Backup.data.emergencyFundGoals
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
  assert.equal(schema9Preview.payload.data.backupCounts.emergencyFundGoals, 0)
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
  const upgradedSchema9Backup = await downloadLedgerBackup(baseUrl)
  assert.equal(upgradedSchema9Backup.payload.data.currency, 'HKD')
  assert.deepEqual(upgradedSchema9Backup.payload.data.emergencyFundGoals, [])
  assert(upgradedSchema9Backup.payload.data.categories.every(
    ({ monthlyPlanMinor }) => monthlyPlanMinor === null,
  ))
  assert(upgradedSchema9Backup.payload.data.transactions.some(({ cleared }) => cleared === false))

  const schema8Backup = withoutYearlyRecurringData(backup)
  schema8Backup.schemaVersion = 8
  delete schema8Backup.data.currency
  schema8Backup.data.accounts = withoutAccountOpeningBalances(schema8Backup.data.accounts)
  delete schema8Backup.data.accountTransfers
  delete schema8Backup.data.emergencyFundGoals
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
  assert.equal(schema8Preview.payload.data.backupCounts.emergencyFundGoals, 0)
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
  const upgradedSchema8Backup = await downloadLedgerBackup(baseUrl)
  assert.equal(upgradedSchema8Backup.payload.data.currency, 'HKD')
  assert.deepEqual(upgradedSchema8Backup.payload.data.emergencyFundGoals, [])
  assert(upgradedSchema8Backup.payload.data.categories.every(
    ({ monthlyPlanMinor }) => monthlyPlanMinor === null,
  ))
  assert(upgradedSchema8Backup.payload.data.transactions.every(({ cleared }) => cleared === true))

  return {
    createdRules: createdRules.length,
    firstRunCreated: firstRun.payload.data.created,
    cronCreated: 1,
    uncappedCsvRows,
    transactionFilterGuards: 5,
    transactionFilterQueries: 7,
    transactionFilterSummaries: 5,
    transactionDateScopeGuards: 4,
    transactionDateScopeQueries: 3,
    transactionDateScopeSummaries: 2,
    transactionDateScopeExports: 2,
    transactionDuplicateChecks: 5,
    transactionDuplicateReviews: 4,
    transactionBulkClearingGuards: 3,
    transactionBulkClearingWrites: 2,
    transactionBulkCategoryGuards: 6,
    transactionBulkCategoryWrites: 2,
    transactionSortQueries: 4,
    transactionTagQueries: 4,
    categorySummaries: 1,
    incomeCategorySummaries: 2,
    payeeSummaries: 2,
    payeeExports: 1,
    cashFlowTrendQueries: 4,
    recurringForecasts: 7 + forecastMonths.length * 2,
    recurringSkips: 2,
    recurringScheduleEndGuards: 2,
    recurringScheduleEndRuns: 2,
    recurringScheduleEndReferenceReleases: 2,
    payeeSuggestions: 1,
    referenceLifecycles: 2,
    referenceSafetyGuards: 4,
    referenceConflictChecks: 4,
    referenceOrderWrites: 2,
    referenceOrderGuards: 3,
    emergencyFundGoalWrites: 5,
    emergencyFundGoalGuards: 10,
    emergencyFundGoalAccountReleases: 1,
    emergencyFundGoalBackupRestores: 1,
    csvImportPreviewStatuses: 5,
    csvImportCategoryCorrections: 1,
    csvImportWrites: 2,
    csvImportMatches: 1,
    csvImportAmbiguityGuards: 1,
    csvImportTombstones: 1,
    csvAtomicRollbacks: 1,
    accountTransferLifecycles: 1,
    accountTransferGuards: 7,
    accountTransferFilterQueries: 3,
    accountBalanceQueries: 3,
    accountBalanceGuards: 3,
    accountRegisterQueries: 9,
    accountRegisterGuards: 9,
    accountRegisterExports: 3,
    accountRegisterExportRows:
      cappedAccountRegisterActivityRows.length + statementActivityRows.length,
    accountRegisterExportGuards: 7,
    accountRegisterExportNoWriteChecks: 2,
    netWorthTrendQueries: 2,
    netWorthTrendGuards: 3,
    ledgerBackupTables: 8,
    ledgerSchema16Restores: 1,
    ledgerSchema15Restores: 1,
    lockedCurrencyChanges: 1,
    ledgerSchema13Restores: 1,
    ledgerSchema12Restores: 1,
    ledgerSchema11Restores: 1,
    ledgerSchema10Restores: 1,
    ledgerSchema9Restores: 1,
    ledgerSchema8Restores: 1,
    ledgerRestoreStaleGuards: 2,
    ledgerRestoreTransactions: 1,
    ...recurringTransfers.evidence,
  }
}

async function verifyNextAiDrafts() {
  const nextPort = await availablePort()
  const providerPort = await availablePort()
  const baseUrl = `http://127.0.0.1:${nextPort}`
  nextProcess = startNextDev(nextPort)
  await waitForNextHealth(baseUrl)

  const developmentServiceWorker = await fetch(`${baseUrl}/sw.js`)
  assert.equal(developmentServiceWorker.status, 200)
  assert.match(developmentServiceWorker.headers.get('cache-control') ?? '', /no-cache.*no-store/)
  const developmentServiceWorkerSource = await developmentServiceWorker.text()
  assert.match(developmentServiceWorkerSource, /skipWaiting\(\)/)
  assert.match(developmentServiceWorkerSource, /registration\.unregister\(\)/)
  assert.doesNotMatch(developmentServiceWorkerSource, /importScripts/)

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

  return {
    nextAiDrafts: 1,
    nextAiD1Writes: 1,
    nextAiTombstones: 1,
    nextDevelopmentServiceWorkerRetirements: 1,
  }
}

async function stopWorker() {
  await stopProcessTree(workerProcess)
}

async function stopNext() {
  await stopProcessTree(nextProcess)
}

function processTreeRunning(child) {
  if (!child?.pid) return false
  if (!supportsProcessGroups) return child.exitCode === null
  try {
    process.kill(-child.pid, 0)
    return true
  } catch {
    return false
  }
}

function signalProcessTree(child, signal) {
  if (!child?.pid) return
  try {
    if (supportsProcessGroups) process.kill(-child.pid, signal)
    else if (child.exitCode === null) child.kill(signal)
  } catch {
    // The process tree already stopped between the liveness check and signal.
  }
}

async function stopProcessTree(child) {
  if (!processTreeRunning(child)) return
  signalProcessTree(child, 'SIGINT')
  const gracefulDeadline = Date.now() + 3_000
  while (processTreeRunning(child) && Date.now() < gracefulDeadline) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50))
  }
  if (!processTreeRunning(child)) return
  signalProcessTree(child, 'SIGKILL')
  const forcedDeadline = Date.now() + 1_000
  while (processTreeRunning(child) && Date.now() < forcedDeadline) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25))
  }
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
  const currencyEvidence = await verifyPristineCurrencyApi()
  await seedCsvExportRows()
  await verifyUpgradeMigration()
  const apiEvidence = await verifyWorkerApi()
  await stopWorker()
  const nextAiEvidence = await verifyNextAiDrafts()
  console.log(
    JSON.stringify({
      ok: true,
      runtime: 'next-open-next-workerd',
      freshMigrations: '0001-0017',
      upgradeMigration: '0004-to-0017-preserved-data-fks-indexes-triggers-yearly-end-dates-and-recurring-transfers',
      ...currencyEvidence,
      ...apiEvidence,
      ...nextAiEvidence,
    }),
  )
} catch (error) {
  const workerOutput = workerProcess?.output().trim()
  if (workerOutput) console.error(workerOutput)
  throw error
} finally {
  await stopWorker()
  await stopNext()
  await stopProvider()
  await rm(temporaryRoot, { recursive: true, force: true })
}
