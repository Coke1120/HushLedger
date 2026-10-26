import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import { auditBundle, parseReleaseVersion, sha256 } from './macos-package.mjs'

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const version = parseReleaseVersion(JSON.parse(readFileSync(join(project, 'package.json'), 'utf8')).version).releaseVersion
const { values } = parseArgs({ options: {
  archive: { type: 'string', default: join(project, 'dist/macos/HushLedger-' + version + '-macos-arm64.zip') },
} })
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Smoke test on Apple Silicon macOS')
const archive = resolve(values.archive)
const stem = archive.slice(0, -4)
for (const line of readFileSync(stem + '.sha256', 'utf8').trim().split('\n')) {
  const match = /^([0-9a-f]{64})  (.+)$/.exec(line)
  assert.ok(match && basename(match[2]) === match[2], 'Invalid checksum file')
  assert.equal(sha256(join(dirname(archive), match[2])), match[1], 'Download checksum mismatch')
}
const root = mkdtempSync(join(tmpdir(), 'hushledger-native-smoke-'))
const support = join(root, 'synthetic-support')
let opened
let clean = false
try {
  assert.equal(spawnSync('/usr/bin/ditto', ['-x', '-k', archive, root], { stdio: 'inherit' }).status, 0)
  const app = join(root, 'HushLedger.app')
  assert.equal(spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' }).status, 0)
  auditBundle(app, [homedir(), project])
  const metadata = JSON.parse(readFileSync(join(app, 'Contents/Resources/build.json'), 'utf8'))
  assert.deepEqual(metadata, JSON.parse(readFileSync(stem + '.build.json', 'utf8')))
  const socket = createServer()
  socket.listen(0, '127.0.0.1')
  await once(socket, 'listening')
  const port = socket.address().port
  await new Promise((done) => socket.close(done))
  opened = spawn('/usr/bin/open', ['-n', '-W', app, '--args',
    '--smoke-test-support', support, '--smoke-test-port', String(port)], { stdio: 'inherit' })
  const exited = once(opened, 'exit')
  const result = join(support, 'smoke-result.json')
  for (let attempt = 0; attempt < 180 && !existsSync(result); attempt += 1) await delay(250)
  assert.ok(existsSync(result), 'Native app did not finish loading its synthetic ledger')
  assert.deepEqual(JSON.parse(readFileSync(result, 'utf8')), { ok: true, url: 'http://127.0.0.1:' + port + '/' })
  await Promise.race([exited, delay(15_000, undefined, { ref: false }).then(() => { throw new Error('Native app did not close') })])
  assert.equal(opened.exitCode, 0)
  assert.equal(existsSync(join(support, 'desktop/server.lock')), false, 'Server lock remains after native quit')
  await assert.rejects(fetch('http://127.0.0.1:' + port + '/api/health', { signal: AbortSignal.timeout(1000) }))
  clean = true
  console.log('Archived native app loaded a fresh synthetic ledger, quit and stopped its owned server.')
} finally {
  // Only signal the test instance, never another HushLedger application.
  const pidFile = join(support, 'smoke.pid')
  if (!clean && existsSync(pidFile)) {
    const pid = Number(readFileSync(pidFile, 'utf8'))
    if (Number.isInteger(pid) && pid > 1) {
      const command = spawnSync('/bin/ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).stdout
      if (command.includes(join(root, 'HushLedger.app/Contents/MacOS/HushLedger'))) {
        try { process.kill(pid, 'SIGTERM') } catch { /* Test instance already stopped. */ }
      }
    }
  }
  if (clean) rmSync(root, { recursive: true, force: true })
  else console.error('Synthetic diagnostics retained at ' + root)
}
