import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

export function parseReleaseVersion(value) {
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(value)) {
    throw new Error('Invalid release version')
  }
  return { releaseVersion: value, version: value.split('-')[0] }
}

export function checkReleaseTag(releaseVersion, tag) {
  if (tag && tag !== 'v' + releaseVersion) throw new Error('Tag does not match package.json version')
}

export function sourceIdentity(source) {
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: source, encoding: 'utf8' })
    return result.status === 0 ? result.stdout.trim() : null
  }
  const files = git('ls-files', '-z', '--cached', '--others', '--exclude-standard')
  const tree = createHash('sha256')
  for (const file of [...new Set((files ?? '').split('\0').filter(Boolean))].sort()) {
    tree.update(file + '\0')
    const path = join(source, file)
    tree.update(existsSync(path) ? readFileSync(path) : '<deleted>')
    tree.update('\0')
  }
  return {
    sourceCommit: git('rev-parse', 'HEAD'),
    sourceRef: git('describe', '--exact-match', '--tags', 'HEAD'),
    sourceDirty: git('status', '--porcelain') !== '',
    sourceTreeSha256: files === null ? null : tree.digest('hex'),
  }
}

// OpenNext embeds tracing roots in generated Next config. These paths refer to
// the build machine, never the destination; keep one stable virtual root instead.
export function portableWorker(code, source) {
  const root = resolve(source)
  return code.replaceAll(root, '/hushledger')
    .replaceAll(JSON.stringify(root).slice(1, -1), '/hushledger')
}

export function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

// Locked npm artifacts retain their publishers' public CI compiler/source paths.
// GitHub uses the same generic home for our runner. Recognize only these exact
// file/prefix pairs when checking that home; checkout and staging roots still
// apply to every byte, and other paths in these files remain prohibited.
const publishedBuildPaths = new Map([
  ['Contents/Resources/server/node_modules/@img/sharp-libvips-darwin-arm64/lib/libvips-cpp.8.18.7.dylib',
    '/Users/runner/work/sharp-libvips/sharp-libvips/'],
  ['Contents/Resources/server/node_modules/fsevents/fsevents.node',
    '/Users/runner/work/fsevents/fsevents/'],
  ['Contents/Resources/server/node_modules/miniflare/dist/src/index.js',
    '/Users/runner/work/workers-sdk/workers-sdk/packages/miniflare/'],
  ['Contents/Resources/server/node_modules/wrangler/wrangler-dist/cli.js',
    '/Users/runner/work/workers-sdk/workers-sdk/packages/wrangler/'],
])

function containsBuildRoot(bytes, root, file) {
  const published = root === '/Users/runner' ? publishedBuildPaths.get(file) : undefined
  if (!published) return bytes.includes(Buffer.from(root))
  return bytes.toString('latin1').replaceAll(published, '').includes(root)
}

export function auditBundle(bundle, forbiddenRoots = []) {
  const roots = [...new Set(forbiddenRoots.filter(Boolean).map((root) => resolve(root)))]
  let files = 0
  function visit(directory) {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name)
      const info = lstatSync(path)
      if (info.isSymbolicLink()) throw new Error('App bundle must not contain symlinks')
      if (['.git', '.wrangler', '.DS_Store'].includes(name)
        || /^\.env(?:\.|$)|^\.dev\.vars(?:\.|$)|\.(?:sqlite3?|db)(?:-wal|-shm)?$|\.log$|\.map$/.test(name)) {
        throw new Error('Private or build-only file in app bundle: ' + name)
      }
      if (info.isDirectory()) { visit(path); continue }
      if (!info.isFile()) throw new Error('Unsupported app bundle entry')
      const bytes = readFileSync(path)
      if (roots.some((root) => containsBuildRoot(bytes, root, relative(bundle, path)))) {
        throw new Error('Build-machine path embedded in app bundle: ' + name)
      }
      files += 1
    }
  }
  visit(bundle)
  return files
}
