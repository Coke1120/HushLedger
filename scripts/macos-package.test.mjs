import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { auditBundle, checkReleaseTag, parseReleaseVersion, portableWorker } from './macos-package.mjs'

test('archive versions cannot escape the output directory and tags must agree', () => {
  assert.deepEqual(parseReleaseVersion('0.1.0-beta.3'), { version: '0.1.0', releaseVersion: '0.1.0-beta.3' })
  for (const value of ['../other', '1.0', '1.0.0/other', '1.0.0\n', '<1.0.0>']) {
    assert.throws(() => parseReleaseVersion(value))
  }
  checkReleaseTag('0.1.0-beta.3', 'v0.1.0-beta.3')
  assert.throws(() => checkReleaseTag('0.1.0-beta.3', 'v0.1.0-beta.2'))
})

test('generated tracing metadata uses a portable root without changing URLs', () => {
  const code = '{"appDir":"/Users/example/project","root":"/Users/example/project","url":"https://example.test"}'
  assert.equal(portableWorker(code, '/Users/example/project'),
    '{"appDir":"/hushledger","root":"/hushledger","url":"https://example.test"}')
})

test('the final bundle audit rejects private files, symlinks and embedded build paths', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'hushledger-package-audit-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(join(root, 'worker.js'), 'export default {}')
  assert.equal(auditBundle(root, ['/Users/example']), 1)
  for (const name of ['.env', '.dev.vars.local', 'ledger.sqlite', 'ledger.sqlite-wal', 'settings.sqlite3', 'server.log', 'worker.js.map']) {
    writeFileSync(join(root, name), 'fixture')
    assert.throws(() => auditBundle(root), /Private or build-only/)
    rmSync(join(root, name))
  }
  writeFileSync(join(root, 'worker.js'), Buffer.from('binary\0/Users/example/private\0'))
  assert.throws(() => auditBundle(root, ['/Users/example']), /Build-machine path/)
  writeFileSync(join(root, 'worker.js'), 'export default {}')
  symlinkSync(join(root, 'worker.js'), join(root, 'alias'))
  assert.throws(() => auditBundle(root), /symlinks/)
})

test('public npm build metadata cannot hide private or checkout paths on a CI runner', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'hushledger-ci-path-audit-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const fixtures = [
    ['@img/sharp-libvips-darwin-arm64/lib/libvips-cpp.8.18.7.dylib', '/Users/runner/work/sharp-libvips/sharp-libvips/target'],
    ['fsevents/fsevents.node', '/Users/runner/work/fsevents/fsevents/build/../src/'],
    ['miniflare/dist/src/index.js', '/Users/runner/work/workers-sdk/workers-sdk/packages/miniflare/src/workers/cache/cache.worker.ts'],
    ['wrangler/wrangler-dist/cli.js', '/Users/runner/work/workers-sdk/workers-sdk/packages/wrangler/templates/startDevWorker/ProxyWorker.ts'],
  ]
  for (const [file, published] of fixtures) {
    const path = join(root, 'Contents/Resources/server/node_modules', file)
    mkdirSync(dirname(path), { recursive: true })
    const original = Buffer.from('fixture\0' + published + '\0')
    writeFileSync(path, original)
    for (const forbidden of ['/Users/runner/Documents/private', '/Users/runner/work/HushLedger/HushLedger/.env']) {
      writeFileSync(path, Buffer.concat([original, Buffer.from(forbidden)]))
      assert.throws(() => auditBundle(root, ['/Users/runner']), /Build-machine path/)
    }
    writeFileSync(path, original)
    const publisherRoot = published.split('/').slice(0, 6).join('/')
    assert.throws(() => auditBundle(root, [publisherRoot]), /Build-machine path/)
  }
  assert.equal(auditBundle(root, ['/Users/runner', '/Users/runner/work/HushLedger/HushLedger']), 4)
  writeFileSync(join(root, 'worker.js'), fixtures[0][1])
  assert.throws(() => auditBundle(root, ['/Users/runner']), /Build-machine path/)
})
