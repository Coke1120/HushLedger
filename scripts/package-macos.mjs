import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, readSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { homedir } from 'node:os'
import { auditBundle, checkReleaseTag, parseReleaseVersion, portableWorker, sourceIdentity } from './macos-package.mjs'

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { values } = parseArgs({ options: {
  'backend-source': { type: 'string', default: project },
  output: { type: 'string', default: join(project, 'dist', 'macos', 'HushLedger.app') },
  'skip-web-build': { type: 'boolean', default: false },
} })
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Build on Apple Silicon macOS')
const source = realpathSync(resolve(values['backend-source']))
const output = resolve(values.output)
if (!output.endsWith('/HushLedger.app')) throw new Error('Output must end in /HushLedger.app')
const node = realpathSync(process.execPath)
const identity = sourceIdentity(source)
const { releaseVersion, version } = parseReleaseVersion(JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')).version)
checkReleaseTag(releaseVersion, process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : null)
const environment = { ...process.env, WRANGLER_SEND_METRICS: 'false', NEXT_TELEMETRY_DISABLED: '1', CI: '1',
  HUSHLEDGER_RELEASE_ID: process.env.HUSHLEDGER_RELEASE_ID ?? identity.sourceCommit ?? releaseVersion }
const require = createRequire(import.meta.url)
const typescript = require('typescript')

function run(command, args, cwd = project) {
  const result = spawnSync(command, args, { cwd, env: environment, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${basename(command)} failed (${result.status})`)
}

function checkNodeDependencies() {
  const result = spawnSync('/usr/bin/otool', ['-L', node], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error('Could not inspect the Node binary')
  for (const line of result.stdout.split('\n').slice(1)) {
    const library = line.trim().split(' (')[0]
    if (library && !library.startsWith('/System/Library/') && !library.startsWith('/usr/lib/')) {
      throw new Error('Use an official standalone Node distribution; this Node depends on external libraries')
    }
  }
}

function resolvePackage(name, parent) {
  let location = parent
  while (true) {
    const candidate = join(location, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return candidate
    const next = dirname(location)
    if (next === location) return undefined
    location = next
  }
}

function copyRuntimeDependencies(destination) {
  const modules = join(source, 'node_modules')
  const visited = new Set()
  function copyPackage(name, parent, optional = false) {
    const root = resolvePackage(name, parent)
    if (!root) {
      if (optional) return
      throw new Error(`Missing runtime dependency: ${name}`)
    }
    const actual = realpathSync(root)
    if (!actual.startsWith(modules + sep)) throw new Error(`Dependency outside node_modules: ${name}`)
    if (visited.has(root)) return
    visited.add(root)
    const target = join(destination, relative(modules, root))
    cpSync(root, target, { recursive: true, dereference: true, filter(path) {
      if (path !== root && basename(path) === 'node_modules') return false
      const name = basename(path)
      if (name.endsWith('.map') || name.startsWith('.env') || name.startsWith('.dev.vars')
        || name.startsWith('.wrangler') || /\.sqlite(?:-|$)/.test(name)) return false
      if (!realpathSync(path).startsWith(modules + sep)) throw new Error('External dependency symlink')
      return true
    } })
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    const optionals = { ...manifest.peerDependencies, ...manifest.optionalDependencies }
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      copyPackage(dependency, root, dependency in (manifest.optionalDependencies ?? {}))
    }
    for (const dependency of Object.keys(optionals)) copyPackage(dependency, root, true)
  }
  copyPackage('wrangler', source)
  return visited.size
}

async function copyMessages(resources) {
  const dictionaries = {}
  const shared = new Set(['edit', 'refresh', 'close', 'cancel', 'discardUnsavedChangesConfirm'])
  for (const locale of ['en', 'zh-Hant', 'ja', 'fr']) {
    const path = join(project, 'src', 'i18n', 'messages', `${locale}.ts`)
    const { outputText } = typescript.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ES2022 },
    })
    const localeExports = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
    const dictionary = Object.values(localeExports)[0]
    dictionaries[locale] = Object.fromEntries(Object.entries(dictionary)
      .filter(([key]) => key.startsWith('desktop') || shared.has(key)))
  }
  writeFileSync(join(resources, 'messages.json'), JSON.stringify(dictionaries))
}

function signMachOFiles(directory) {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, item.name)
    if (item.isDirectory()) { signMachOFiles(path); continue }
    if (!item.isFile() || lstatSync(path).size < 4) continue
    const fd = openSync(path, 'r')
    const header = Buffer.alloc(4)
    readSync(fd, header, 0, 4, 0)
    closeSync(fd)
    if (['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf'].includes(header.toString('hex'))) {
      run('/usr/bin/codesign', ['--force', '--sign', '-', path])
    }
  }
}

checkNodeDependencies()
if (!values['skip-web-build']) run('npm', ['run', 'build:cloudflare'], source)
if (!existsSync(join(source, '.open-next', 'worker.js'))) throw new Error('Build the OpenNext backend first')
mkdirSync(dirname(output), { recursive: true })
const staging = mkdtempSync(join(dirname(output), '.hushledger-package-'))
const bundle = join(staging, 'HushLedger.app')
try {
  const contents = join(bundle, 'Contents')
  const resources = join(contents, 'Resources')
  const server = join(resources, 'server')
  mkdirSync(join(contents, 'MacOS'), { recursive: true })
  mkdirSync(join(resources, 'bin'), { recursive: true })
  mkdirSync(server)
  copyFileSync(node, join(resources, 'bin', 'node'))
  for (const file of ['server.mjs', 'lifecycle.mjs']) {
    copyFileSync(join(project, 'desktop', 'macos', file), join(resources, file))
  }
  mkdirSync(join(server, 'scripts'))
  copyFileSync(join(source, 'scripts', 'private-local-state.cjs'), join(server, 'scripts', 'private-local-state.cjs'))
  const wrangler = join(source, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
  run(node, [wrangler, 'deploy', '--dry-run', '--outdir', join(server, 'worker')], source)
  for (const name of readdirSync(join(server, 'worker'))) {
    if (name.endsWith('.map')) rmSync(join(server, 'worker', name))
    else if (name.endsWith('.js')) {
      const path = join(server, 'worker', name)
      writeFileSync(path, portableWorker(readFileSync(path, 'utf8'), source))
    }
  }
  cpSync(join(source, '.open-next', 'assets'), join(server, 'assets'), { recursive: true })
  cpSync(join(source, 'migrations'), join(server, 'migrations'), { recursive: true })
  const config = JSON.parse(readFileSync(join(source, 'wrangler.jsonc'), 'utf8'))
  if (config.d1_databases?.length !== 1 || config.d1_databases[0].binding !== 'DB') {
    throw new Error('Expected a single local HushLedger D1 binding')
  }
  writeFileSync(join(server, 'config.json'), JSON.stringify({
    name: 'hushledger', main: 'worker/custom-worker.js',
    compatibility_date: config.compatibility_date, compatibility_flags: config.compatibility_flags,
    assets: { directory: 'assets', binding: 'ASSETS', run_worker_first: true },
    d1_databases: [{ binding: 'DB', database_name: 'hushledger',
      database_id: config.d1_databases[0].database_id, migrations_dir: 'migrations' }],
    observability: { enabled: false },
  }))
  const packages = copyRuntimeDependencies(join(server, 'node_modules'))
  await copyMessages(resources)
  const iconset = join(staging, 'AppIcon.iconset')
  mkdirSync(iconset)
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      run('/usr/bin/sips', ['-z', String(size * scale), String(size * scale),
        join(source, 'public', 'apple-touch-icon.png'), '--out',
        join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`)])
    }
  }
  run('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', join(resources, 'AppIcon.icns')])
  const target = 'arm64-apple-macosx13.5'
  run('/usr/bin/xcrun', ['swiftc', '-swift-version', '5', '-O', '-target', target,
    '-framework', 'AppKit', '-framework', 'WebKit', join(project, 'desktop', 'macos', 'main.swift'),
    '-o', join(contents, 'MacOS', 'HushLedger')])
  writeFileSync(join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>app.hushledger.desktop</string>
<key>CFBundleExecutable</key><string>HushLedger</string>
<key>CFBundleName</key><string>HushLedger</string>
<key>CFBundleDisplayName</key><string>HushLedger</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
<key>CFBundleVersion</key><string>1</string>
<key>HushLedgerReleaseVersion</key><string>${releaseVersion}</string>
<key>CFBundleIconFile</key><string>AppIcon</string>
<key>LSMinimumSystemVersion</key><string>13.5</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSPrincipalClass</key><string>NSApplication</string>
<key>CFBundleLocalizations</key><array><string>en</string><string>zh-Hant</string><string>ja</string><string>fr</string></array>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/><key>NSAllowsArbitraryLoadsInWebContent</key><true/></dict>
</dict></plist>`)
  const manifest = {
    version, releaseVersion, ...identity, architecture: process.arch, node: process.version, runtimePackages: packages,
    signing: 'ad-hoc', notarized: false,
    minimumMacOS: '13.5',
    workerSha256: createHash('sha256').update(readFileSync(join(server, 'worker', 'custom-worker.js'))).digest('hex'),
    wrangler: JSON.parse(readFileSync(join(source, 'node_modules', 'wrangler', 'package.json'), 'utf8')).version,
  }
  writeFileSync(join(resources, 'build.json'), JSON.stringify(manifest, null, 2))
  if (existsSync(join(source, 'LICENSE'))) copyFileSync(join(source, 'LICENSE'), join(resources, 'LICENSE'))
  const nodeLicense = join(dirname(dirname(node)), 'LICENSE')
  if (existsSync(nodeLicense)) copyFileSync(nodeLicense, join(resources, 'NODE-LICENSE'))
  auditBundle(bundle, [homedir(), source, project, staging, process.env.GITHUB_WORKSPACE])
  signMachOFiles(contents)
  run('/usr/bin/codesign', ['--force', '--sign', '-', bundle])
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle])
  if (existsSync(output)) {
    const prior = readFileSync(join(output, 'Contents', 'Info.plist'), 'utf8')
    if (!prior.includes('<string>app.hushledger.desktop</string>')) throw new Error('Refusing to replace an unrelated app')
    rmSync(output, { recursive: true })
  }
  renameSync(bundle, output)
  console.log(`Packaged ${output} (${packages} runtime packages). No user ledger data was included.`)
} finally {
  rmSync(staging, { recursive: true, force: true })
}
