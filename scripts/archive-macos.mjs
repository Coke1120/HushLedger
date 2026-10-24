import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { auditBundle, parseReleaseVersion, sha256 } from './macos-package.mjs'

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { values } = parseArgs({ options: {
  bundle: { type: 'string', default: join(project, 'dist/macos/HushLedger.app') },
  output: { type: 'string', default: join(project, 'dist/macos') },
} })
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Archive on Apple Silicon macOS')
const bundle = resolve(values.bundle)
const output = resolve(values.output)
const manifest = JSON.parse(readFileSync(join(bundle, 'Contents/Resources/build.json'), 'utf8'))
parseReleaseVersion(manifest.releaseVersion)
if (manifest.architecture !== 'arm64' || manifest.signing !== 'ad-hoc' || manifest.notarized !== false) {
  throw new Error('Expected a locally signed, unnotarized arm64 package')
}
auditBundle(bundle, [homedir(), project, process.env.GITHUB_WORKSPACE])
const verified = spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'inherit' })
if (verified.status !== 0) throw new Error('App signature verification failed')
mkdirSync(output, { recursive: true })
const stem = 'HushLedger-' + manifest.releaseVersion + '-macos-arm64'
const archive = join(output, stem + '.zip')
if (existsSync(archive)) throw new Error('Archive already exists; use a new output directory')
const zipped = spawnSync('/usr/bin/ditto', ['-c', '-k', '--norsrc', '--keepParent', bundle, archive], { stdio: 'inherit' })
if (zipped.status !== 0) throw new Error('App archive failed')
const metadata = join(output, stem + '.build.json')
const notice = join(output, stem + '.README.txt')
writeFileSync(metadata, JSON.stringify(manifest, null, 2) + '\n')
writeFileSync(notice, [
  'HushLedger ' + manifest.releaseVersion + ' for Apple Silicon (arm64)',
  'Source commit: ' + (manifest.sourceCommit ?? 'unknown'),
  'Uncommitted source changes: ' + manifest.sourceDirty,
  '',
  'This is an ad-hoc signed preview, without Developer ID signing or notarization.',
  'macOS may block a downloaded build. The workflow does not remove quarantine or bypass Gatekeeper.',
  'Back up your ledger and settings before replacing an existing app or applying migrations.',
  'Extract HushLedger.app, copy it to ~/Applications and open it normally.',
  'The app starts its bundled local server; closing its last window shuts that server down.',
  'Data stays in ~/Library/Application Support/HushLedger/source/.wrangler/state/.',
  'This archive contains no user database or settings. No separate Node installation is required.',
  '',
].join('\n'))
writeFileSync(join(output, stem + '.sha256'), [archive, metadata, notice]
  .map((path) => sha256(path) + '  ' + basename(path)).join('\n') + '\n')
console.log('Archived ' + basename(archive) + ' with SHA-256 checksums and build metadata.')
