import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { constants, closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { basename, dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import { createLedgerGateway, stopOwnedProcessGroup } from './lifecycle.mjs'

process.umask(0o077)
const { values } = parseArgs({ options: {
  resources: { type: 'string' }, support: { type: 'string' }, 'parent-pid': { type: 'string' },
  port: { type: 'string', default: '8787' },
} })
if (!values.resources || !values.support || !/^\d+$/.test(values['parent-pid'] ?? '')) {
  throw new Error('Expected resources, support and parent-pid arguments')
}
const resources = resolve(values.resources)
const requestedSupport = resolve(values.support)
const support = join(realpathSync(dirname(requestedSupport)), basename(requestedSupport))
const parentPid = Number(values['parent-pid'])
const publicPort = Number(values.port)
if (!/^\d+$/.test(values.port) || !Number.isInteger(publicPort) || publicPort < 1024 || publicPort > 65535) {
  throw new Error('Expected a loopback port from 1024 through 65535')
}
const runtime = join(support, 'desktop')
const state = join(support, 'source', '.wrangler', 'state')
const lockPath = join(runtime, 'server.lock')
const logPath = join(runtime, 'server.log')
const configPath = join(runtime, 'wrangler.json')
const gateway = createLedgerGateway(publicPort)
let child
let ownsLock = false
let stopping = false
let log
let parentWatch
let shutdownPromise

function notify(event, extra = {}) {
  if (!process.stdout.destroyed) process.stdout.write(`${JSON.stringify({ event, ...extra })}\n`)
}

function privateDirectory(directory) {
  if (directory !== support) privateDirectory(dirname(directory))
  if (existsSync(directory)) {
    const info = lstatSync(directory)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Unsafe state directory')
    return
  }
  mkdirSync(directory, { mode: 0o700 })
}

function rotatePrivateLog(path) {
  let info
  try { info = lstatSync(path) } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  if (!info.isFile() || info.isSymbolicLink() || info.nlink > 1) throw new Error('Unsafe log file')
  renameSync(path, `${path}.previous`)
}

function acquireLock() {
  if (existsSync(lockPath)) {
    const info = lstatSync(lockPath)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Unsafe lock file')
    const prior = JSON.parse(readFileSync(lockPath, 'utf8'))
    if (!Number.isSafeInteger(prior.pid) || prior.pid < 2) throw new Error('Invalid lock file')
    try {
      process.kill(prior.pid, 0)
      throw Object.assign(new Error('Ledger is already open'), { code: 'LEDGER_BUSY' })
    } catch (error) {
      if (error.code !== 'ESRCH') throw error
    }
    unlinkSync(lockPath)
  }
  writeFileSync(lockPath, JSON.stringify({ pid: process.pid }), { flag: 'wx', mode: 0o600 })
  ownsLock = true
}

async function shutdown(code = 0) {
  if (shutdownPromise) return shutdownPromise
  stopping = true
  notify('stopping')
  shutdownPromise = (async () => {
    clearInterval(parentWatch)
    await gateway.close()
    await stopOwnedProcessGroup(child)
    if (ownsLock && existsSync(lockPath)) unlinkSync(lockPath)
    if (log !== undefined) closeSync(log)
    process.exit(code)
  })()
  return shutdownPromise
}

function fail(error) {
  if (stopping) return
  notify('error', { code: error.code === 'EADDRINUSE' ? 'PORT_IN_USE'
    : error.code === 'LEDGER_BUSY' ? 'LEDGER_BUSY' : 'START_FAILED' })
  process.stderr.write(`${error.stack ?? error}\n`)
  void shutdown(1)
}

function startWrangler(arguments_) {
  if (stopping) throw new Error('Shutdown requested')
  const environment = {
    HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
    PATH: `${join(resources, 'bin')}:/usr/bin:/bin:/usr/sbin:/sbin`,
    LANG: process.env.LANG ?? 'en_US.UTF-8', CI: '1', NO_COLOR: '1',
    WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG: 'error',
    WRANGLER_LOG_PATH: join(runtime, 'wrangler.log'),
  }
  child = spawn(process.execPath, [
    '-r', join(resources, 'server', 'scripts', 'private-local-state.cjs'),
    join(resources, 'server', 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
    ...arguments_, '--config', configPath, '--persist-to', state,
  ], { cwd: runtime, env: environment, detached: true, stdio: ['ignore', log, log] })
  return child
}

async function availablePort() {
  const socket = createServer()
  await new Promise((resolveReady, reject) => {
    socket.once('error', reject)
    socket.listen(0, '127.0.0.1', resolveReady)
  })
  const { port } = socket.address()
  await new Promise((resolveClosed) => socket.close(resolveClosed))
  return port
}

async function waitForServer(port, worker) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (stopping) return false
    if (worker.exitCode !== null || worker.signalCode !== null) throw new Error('Worker stopped during startup')
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) })
      const body = await response.json()
      if (response.ok && body.ok === true) return true
    } catch { /* The Worker has not finished starting yet. */ }
    await delay(250)
  }
  throw new Error('Local ledger startup timed out')
}

async function main() {
  privateDirectory(runtime)
  // Reserve the public address before touching the ledger or stale lock.
  await gateway.listen()
  if (stopping) return
  acquireLock()
  privateDirectory(state)
  rotatePrivateLog(logPath)
  rotatePrivateLog(join(runtime, 'wrangler.log'))
  log = openSync(logPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
  const template = JSON.parse(readFileSync(join(resources, 'server', 'config.json'), 'utf8'))
  template.main = join(resources, 'server', 'worker', 'custom-worker.js')
  template.assets.directory = join(resources, 'server', 'assets')
  template.d1_databases[0].migrations_dir = join(resources, 'server', 'migrations')
  const temporaryConfig = join(runtime, `config-${randomUUID()}.tmp`)
  writeFileSync(temporaryConfig, JSON.stringify(template), { mode: 0o600, flag: 'wx' })
  renameSync(temporaryConfig, configPath)
  const migration = startWrangler(['d1', 'migrations', 'apply', 'hushledger', '--local'])
  await new Promise((resolveDone, reject) => {
    migration.once('error', reject)
    migration.once('exit', (code) => code === 0 ? resolveDone() : reject(new Error('Database preparation failed')))
  })
  if (stopping) return
  const port = await availablePort()
  const worker = startWrangler(['dev', '--local', '--no-bundle', '--ip', '127.0.0.1',
    '--port', String(port), '--inspector-port', '0', '--show-interactive-dev-session=false'])
  worker.once('error', fail)
  worker.once('exit', () => { if (!stopping) fail(new Error('Local ledger exited')) })
  if (!await waitForServer(port, worker)) return
  gateway.setBackend(port)
  notify('ready', { url: 'http://127.0.0.1:' + publicPort + '/' })
}

process.stdin.resume()
process.stdin.on('data', () => { void shutdown() })
process.stdin.on('end', () => { void shutdown() })
process.on('SIGINT', () => { void shutdown() })
process.on('SIGTERM', () => { void shutdown() })
process.stdout.on('error', () => { void shutdown() })
parentWatch = setInterval(() => {
  try { process.kill(parentPid, 0) } catch { void shutdown() }
}, 1000)
void main().catch(fail)
