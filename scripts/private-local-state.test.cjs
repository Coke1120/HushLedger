/* eslint-disable @typescript-eslint/no-require-imports -- This test exercises a CommonJS preload. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { afterEach, describe, it } = require('node:test')

const projectRoot = path.resolve(__dirname, '..')
const preloadPath = path.join(__dirname, 'private-local-state.cjs')
const wranglerPath = path.join(projectRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
const temporaryDirectories = []
const migrationApplyTimeoutMs = 120_000

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true })
  }
})

describe('private local state launcher', { skip: process.platform === 'win32' }, () => {
  it('repairs existing modes and gives real Wrangler state owner-only permissions', () => {
    const temporaryDirectory = makeTemporaryDirectory()
    const stateDirectory = path.join(temporaryDirectory, 'wrangler-state')
    const legacyDirectory = path.join(stateDirectory, 'legacy')
    fs.mkdirSync(legacyDirectory, { recursive: true, mode: 0o755 })
    fs.writeFileSync(path.join(legacyDirectory, 'ledger.sqlite'), 'fictional test data', { mode: 0o644 })
    fs.chmodSync(stateDirectory, 0o755)
    fs.chmodSync(legacyDirectory, 0o755)

    const result = spawnSync(process.execPath, [
      '-r',
      preloadPath,
      wranglerPath,
      'd1',
      'migrations',
      'apply',
      'hushledger',
      '--local',
      '--persist-to',
      stateDirectory,
    ], {
      cwd: projectRoot,
      encoding: 'utf8',
      env: { ...process.env, CI: 'true', NO_COLOR: '1' },
      timeout: migrationApplyTimeoutMs,
    })

    assert.equal(result.status, 0, result.stderr || result.stdout)
    assertPrivateTree(stateDirectory)
    assert(findFiles(stateDirectory).some((file) => file.endsWith('.sqlite')))
  })

  it('rejects a symlinked state root without changing its target', () => {
    const temporaryDirectory = makeTemporaryDirectory()
    const targetDirectory = path.join(temporaryDirectory, 'shared-target')
    const stateDirectory = path.join(temporaryDirectory, 'wrangler-state')
    const probePath = path.join(temporaryDirectory, 'probe.cjs')
    fs.mkdirSync(targetDirectory, { mode: 0o755 })
    fs.writeFileSync(path.join(targetDirectory, 'unrelated.txt'), 'leave me alone', { mode: 0o644 })
    fs.symlinkSync(targetDirectory, stateDirectory, 'dir')
    fs.writeFileSync(probePath, '')

    const result = spawnSync(process.execPath, [
      '-r',
      preloadPath,
      probePath,
      '--persist-to',
      stateDirectory,
    ], { cwd: projectRoot, encoding: 'utf8' })

    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /cannot contain symbolic links/)
    assert.equal(modeOf(targetDirectory), 0o755)
    assert.equal(modeOf(path.join(targetDirectory, 'unrelated.txt')), 0o644)
  })

  for (const finalDirectoryExists of [false, true]) {
    it(`rejects an intermediate symlink when the state root ${finalDirectoryExists ? 'exists' : 'is missing'}`, () => {
      const temporaryDirectory = makeTemporaryDirectory()
      const targetDirectory = path.join(temporaryDirectory, 'shared-target')
      const linkedDirectory = path.join(temporaryDirectory, 'linked-parent')
      const stateDirectory = path.join(linkedDirectory, 'wrangler-state')
      const targetStateDirectory = path.join(targetDirectory, 'wrangler-state')
      const probePath = path.join(temporaryDirectory, 'probe.cjs')
      fs.mkdirSync(targetDirectory, { mode: 0o755 })
      fs.writeFileSync(path.join(targetDirectory, 'unrelated.txt'), 'leave me alone', { mode: 0o644 })
      if (finalDirectoryExists) {
        fs.mkdirSync(targetStateDirectory, { mode: 0o755 })
        fs.writeFileSync(path.join(targetStateDirectory, 'ledger.sqlite'), 'fictional test data', { mode: 0o644 })
      }
      fs.symlinkSync(targetDirectory, linkedDirectory, 'dir')
      fs.writeFileSync(probePath, '')

      const result = spawnSync(process.execPath, [
        '-r',
        preloadPath,
        probePath,
        '--persist-to',
        stateDirectory,
      ], { cwd: projectRoot, encoding: 'utf8' })

      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /cannot contain symbolic links/)
      assert.equal(modeOf(targetDirectory), 0o755)
      assert.equal(modeOf(path.join(targetDirectory, 'unrelated.txt')), 0o644)
      if (finalDirectoryExists) {
        assert.equal(modeOf(targetStateDirectory), 0o755)
        assert.equal(modeOf(path.join(targetStateDirectory, 'ledger.sqlite')), 0o644)
      } else {
        assert.equal(fs.existsSync(targetStateDirectory), false)
      }
    })
  }

  it('ignores the Next-only persistence variable when Wrangler uses its default state', () => {
    const temporaryDirectory = makeTemporaryDirectory()
    const ignoredStateDirectory = path.join(temporaryDirectory, 'next-state')
    const wranglerStateDirectory = path.join(temporaryDirectory, '.wrangler')
    fs.mkdirSync(ignoredStateDirectory, { mode: 0o755 })
    fs.writeFileSync(path.join(ignoredStateDirectory, 'unrelated.txt'), 'leave me alone', { mode: 0o644 })
    fs.cpSync(path.join(projectRoot, 'migrations'), path.join(temporaryDirectory, 'migrations'), { recursive: true })
    fs.writeFileSync(path.join(temporaryDirectory, 'wrangler.jsonc'), JSON.stringify({
      compatibility_date: '2026-07-11',
      d1_databases: [{
        binding: 'DB',
        database_id: 'test-only-database-id',
        database_name: 'hushledger',
        migrations_dir: 'migrations',
      }],
      main: 'unused.ts',
      name: 'hushledger-permission-test',
    }))

    const result = spawnSync(process.execPath, [
      '-r',
      preloadPath,
      wranglerPath,
      '--cwd',
      temporaryDirectory,
      'd1',
      'migrations',
      'apply',
      'hushledger',
      '--local',
    ], {
      cwd: projectRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        CI: 'true',
        HUSHLEDGER_DEV_PERSIST_PATH: ignoredStateDirectory,
        NO_COLOR: '1',
      },
      timeout: migrationApplyTimeoutMs,
    })

    assert.equal(result.status, 0, result.stderr || result.stdout)
    assertPrivateTree(wranglerStateDirectory)
    assert(findFiles(wranglerStateDirectory).some((file) => file.endsWith('.sqlite')))
    assert.equal(modeOf(ignoredStateDirectory), 0o755)
    assert.equal(modeOf(path.join(ignoredStateDirectory, 'unrelated.txt')), 0o644)
  })

  it('rejects hard-linked files without changing the external target', () => {
    const temporaryDirectory = makeTemporaryDirectory()
    const stateDirectory = path.join(temporaryDirectory, 'wrangler-state')
    const externalFile = path.join(temporaryDirectory, 'outside-ledger.sqlite')
    const probePath = path.join(temporaryDirectory, 'probe.cjs')
    fs.mkdirSync(stateDirectory, { mode: 0o755 })
    fs.writeFileSync(externalFile, 'leave me alone', { mode: 0o644 })
    fs.linkSync(externalFile, path.join(stateDirectory, 'ledger.sqlite'))
    fs.writeFileSync(probePath, '')

    const result = spawnSync(process.execPath, [
      '-r',
      preloadPath,
      probePath,
      '--persist-to',
      stateDirectory,
    ], { cwd: projectRoot, encoding: 'utf8' })

    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /cannot contain hard-linked files/)
    assert.equal(modeOf(stateDirectory), 0o755)
    assert.equal(modeOf(externalFile), 0o644)
  })

  it('removes macOS ACL grants before using local state', { skip: process.platform !== 'darwin' }, () => {
    const temporaryDirectory = makeTemporaryDirectory()
    const stateDirectory = path.join(temporaryDirectory, 'wrangler-state')
    const ledgerFile = path.join(stateDirectory, 'ledger.sqlite')
    const probePath = path.join(temporaryDirectory, 'probe.cjs')
    fs.mkdirSync(stateDirectory, { mode: 0o755 })
    fs.writeFileSync(ledgerFile, 'fictional test data', { mode: 0o644 })
    fs.writeFileSync(probePath, '')
    addMacOsAcl(stateDirectory)
    addMacOsAcl(ledgerFile)
    assert.equal(hasMacOsAcl(stateDirectory), true)
    assert.equal(hasMacOsAcl(ledgerFile), true)

    const result = spawnSync(process.execPath, [
      '-r',
      preloadPath,
      probePath,
      '--persist-to',
      stateDirectory,
    ], { cwd: projectRoot, encoding: 'utf8' })

    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.equal(hasMacOsAcl(stateDirectory), false)
    assert.equal(hasMacOsAcl(ledgerFile), false)
    assertPrivateTree(stateDirectory)
  })

  it('rejects a case alias of the protected working directory on macOS', { skip: process.platform !== 'darwin' }, (context) => {
    const temporaryDirectory = makeTemporaryDirectory()
    const protectedDirectory = path.join(temporaryDirectory, 'ProtectedState')
    const caseAlias = path.join(temporaryDirectory, 'protectedstate')
    const protectedFile = path.join(protectedDirectory, 'unrelated.txt')
    const probePath = path.join(temporaryDirectory, 'probe.cjs')
    fs.mkdirSync(protectedDirectory, { mode: 0o755 })
    fs.writeFileSync(protectedFile, 'leave me alone', { mode: 0o644 })
    fs.writeFileSync(probePath, '')
    if (!fs.existsSync(caseAlias)) {
      context.skip('the test volume is case-sensitive')
      return
    }

    const result = spawnSync(process.execPath, [
      '-r',
      preloadPath,
      probePath,
      '--persist-to',
      caseAlias,
    ], { cwd: protectedDirectory, encoding: 'utf8' })

    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /too broad to secure safely/)
    assert.equal(modeOf(protectedDirectory), 0o755)
    assert.equal(modeOf(protectedFile), 0o644)
  })
})

function makeTemporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hushledger-private-state-'))
  temporaryDirectories.push(directory)
  return directory
}

function assertPrivateTree(directory) {
  const details = fs.lstatSync(directory)
  assert.equal(details.isSymbolicLink(), false, directory)
  assert.equal(modeOf(directory), details.isDirectory() ? 0o700 : 0o600, directory)
  if (!details.isDirectory()) return
  for (const name of fs.readdirSync(directory)) {
    assertPrivateTree(path.join(directory, name))
  }
}

function findFiles(directory) {
  return fs.readdirSync(directory).flatMap((name) => {
    const entryPath = path.join(directory, name)
    return fs.lstatSync(entryPath).isDirectory() ? findFiles(entryPath) : [entryPath]
  })
}

function modeOf(entryPath) {
  return fs.lstatSync(entryPath).mode & 0o777
}

function addMacOsAcl(entryPath) {
  const result = spawnSync('/bin/chmod', ['+a', 'everyone allow read', entryPath], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
}

function hasMacOsAcl(entryPath) {
  const result = spawnSync('/bin/ls', ['-lde', entryPath], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return /\n\s+\d+:/.test(result.stdout)
}
