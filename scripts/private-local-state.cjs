/* eslint-disable @typescript-eslint/no-require-imports -- Node --require preloads are CommonJS. */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

if (process.platform !== 'win32') {
  process.umask(0o077)
  removeThisPreloadFromChildProcesses()

  try {
    hardenStateDirectory(resolveStateDirectory(process.argv, process.env))
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown filesystem error'
    console.error(`HushLedger refused to use local state: ${reason}`)
    process.exit(1)
  }
}

function removeThisPreloadFromChildProcesses() {
  for (let index = process.execArgv.length - 1; index >= 0; index -= 1) {
    const argument = process.execArgv[index]
    if ((argument === '-r' || argument === '--require') && index + 1 < process.execArgv.length) {
      if (path.resolve(process.execArgv[index + 1]) === __filename) {
        process.execArgv.splice(index, 2)
      }
      continue
    }
    const inlinePrefix = argument.startsWith('--require=')
      ? '--require='
      : argument.startsWith('-r=')
        ? '-r='
        : null
    if (inlinePrefix && path.resolve(argument.slice(inlinePrefix.length)) === __filename) {
      process.execArgv.splice(index, 1)
    }
  }
}

function resolveStateDirectory(argv, env) {
  const launchDirectory = isWranglerCli(argv)
    ? path.resolve(process.cwd(), readOption(argv, '--cwd') || '.')
    : process.cwd()
  const explicitPath = readOption(argv, '--persist-to')
  if (explicitPath) return safeStatePath(path.resolve(launchDirectory, explicitPath))

  const defaultPath = isNextCli(argv) && env.HUSHLEDGER_DEV_PERSIST_PATH
    ? env.HUSHLEDGER_DEV_PERSIST_PATH
    : '.wrangler'
  return safeStatePath(path.resolve(launchDirectory, defaultPath))
}

function readOption(argv, option) {
  for (let index = 2; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === option) {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) throw new Error(`${option} requires a directory`)
      return value
    }
    if (argument.startsWith(`${option}=`)) {
      const value = argument.slice(option.length + 1)
      if (!value) throw new Error(`${option} requires a directory`)
      return value
    }
  }
  return null
}

function isNextCli(argv) {
  return argv[1]
    ? path.resolve(argv[1]) === path.resolve(__dirname, '..', 'node_modules', 'next', 'dist', 'bin', 'next')
    : false
}

function isWranglerCli(argv) {
  return argv[1]
    ? path.resolve(argv[1]) === path.resolve(__dirname, '..', 'node_modules', 'wrangler', 'bin', 'wrangler.js')
    : false
}

function safeStatePath(requestedPath) {
  const requested = path.resolve(requestedPath)
  const trustedBases = [process.cwd(), os.homedir(), os.tmpdir()]
    .map((base) => path.resolve(base))
    .filter((base, index, bases) => bases.indexOf(base) === index)
    .map((base) => ({ canonical: fs.realpathSync.native(base), requested: base }))
  const resolved = canonicalizeSafePath(requested, trustedBases)
  const filesystemRoot = path.parse(resolved).root
  const parts = resolved.slice(filesystemRoot.length).split(path.sep).filter(Boolean)
  const protectedPaths = trustedBases.map((base) => base.canonical)

  if (
    resolved === filesystemRoot
    || parts.length < 2
    || protectedPaths.some((protectedPath) => (
      resolved === protectedPath || protectedPath.startsWith(`${resolved}${path.sep}`)
    ))
  ) {
    throw new Error('the persistence directory is too broad to secure safely')
  }

  return resolved
}

function isSameOrWithin(candidate, directory) {
  return candidate === directory || candidate.startsWith(`${directory}${path.sep}`)
}

function canonicalizeSafePath(requested, trustedBases) {
  const filesystemRoot = path.parse(requested).root
  const components = requested.slice(filesystemRoot.length).split(path.sep).filter(Boolean)
  let existingAncestor = filesystemRoot

  for (let index = 0; index < components.length; index += 1) {
    const candidate = path.join(existingAncestor, components[index])
    let details
    try {
      details = fs.lstatSync(candidate)
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        return path.join(fs.realpathSync.native(existingAncestor), ...components.slice(index))
      }
      throw error
    }

    const isTrustedBaseComponent = trustedBases.some((base) => isSameOrWithin(base.requested, candidate))
    if (details.isSymbolicLink() && !isTrustedBaseComponent) {
      throw new Error('the persistence path cannot contain symbolic links')
    }
    existingAncestor = candidate
  }

  return fs.realpathSync.native(existingAncestor)
}

function hardenStateDirectory(directory) {
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  }

  const entries = inspectStateTree(directory)
  if (!entries[0].details.isDirectory()) {
    throw new Error('the persistence path must be a directory')
  }

  if (process.platform === 'darwin') removeMacOsAcls(directory)
  for (const entry of entries) {
    fs.chmodSync(entry.path, entry.details.isDirectory() ? 0o700 : 0o600)
  }
}

function inspectStateTree(entryPath, entries = []) {
  const details = fs.lstatSync(entryPath)
  if (details.isSymbolicLink()) {
    throw new Error('the persistence directory cannot contain symbolic links')
  }
  if (!details.isDirectory() && !details.isFile()) {
    throw new Error('the persistence directory can contain only directories and regular files')
  }
  if (details.isFile() && details.nlink > 1) {
    throw new Error('the persistence directory cannot contain hard-linked files')
  }

  entries.push({ details, path: entryPath })
  if (details.isDirectory()) {
    for (const name of fs.readdirSync(entryPath)) {
      inspectStateTree(path.join(entryPath, name), entries)
    }
  }
  return entries
}

function removeMacOsAcls(directory) {
  const result = spawnSync('/bin/chmod', ['-R', '-P', '-N', directory], { encoding: 'utf8' })
  if (result.status === 0) return

  const reason = result.error?.message || result.stderr.trim() || result.stdout.trim() || 'chmod failed'
  throw new Error(`macOS ACL removal failed: ${reason}`)
}
