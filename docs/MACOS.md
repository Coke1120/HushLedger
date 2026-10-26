# macOS desktop package

The native AppKit/WebKit window starts HushLedger's bundled local Worker runtime,
waits for database health, then opens the ledger. Closing the window or choosing
Quit waits for accepted HTTP requests to finish and stops the runtime's process
group. The supervisor also shuts down if its parent app exits unexpectedly.

The existing React UI, API and D1 schema are retained. There is no Rust port and
no Node or npm installation required on the destination Mac. Launches use a
prebuilt Worker; they do not run a Next.js build.

## Build and install

Use macOS 13.5 or newer, Xcode command line tools, an official standalone Node 22+
binary, and the locked npm dependencies. A Homebrew Node with external dylib
dependencies is rejected so the resulting app cannot silently depend on the
build machine's Homebrew installation.

```sh
npm ci
npm run package:macos
```

The result is `dist/macos/HushLedger.app`, built for Apple Silicon (arm64). The packager rejects other architectures.
Copy it to `~/Applications` and open it. The package is signed ad hoc for local
installation. Distributing it to other users additionally requires a Developer
ID signing and notarization release workflow; that is not performed by this script.

To package an existing, already built backend:

```sh
npm run package:macos -- --backend-source '/path/to/backend' --skip-web-build
```

The builder copies only compiled Worker code, static assets, migrations, the
required runtime dependency closure and Node. It never copies `.wrangler`,
ledger databases, exports, backups, environment files or Git history. The
runtime versions and Worker checksum are recorded inside `Resources/build.json`.

## Data and lifecycle

The local ledger continues to use:

```text
~/Library/Application Support/HushLedger/source/.wrangler/state/
```

Application upgrades replace code, not this directory. Existing D1 binding
identity is preserved. Pending migrations are applied before the window loads;
a fresh installation receives the same schema as a local Worker deployment.
Back up the ledger before installing an application with new migrations.

The app owns `127.0.0.1:8787`. Close any manually started HushLedger preview before
opening the app. A port conflict produces a visible error; the app does not adopt
or kill another process. A process lock prevents a second desktop supervisor
from opening the same ledger during shutdown. Node/Worker diagnostics are private
files in `~/Library/Application Support/HushLedger/desktop/`.

The gateway allows only the app's loopback host and origin, forwards requests to
the owned Worker, and tracks upstream completion even if a window disconnects.
On an ordinary close, accepted requests drain before process termination. A
forced OS kill cannot guarantee completion of an unsent browser draft; the
supervisor still cleans up its Worker process tree after the parent disappears.
Unsaved forms use the app's existing before-unload confirmation.

The window supports file upload, download save dialogs, standard editing
shortcuts, and external links in the default browser. Native startup/error/menu
copy is built from the same four locale dictionaries as the web app.

As with the previous local preview, Cloudflare's scheduled cron is not run while
the desktop app is closed. The app does not install a login item or background
service.

## Checks

```sh
npm run test:macos
npm run typecheck
npm run lint
```

Also exercise the packaged application: launch, read the ledger, close the last
window, verify the listener and owned processes exit, then reopen and confirm
the same data remains. Exercise file import/export and unsaved-form confirmation
in the native window before publishing a desktop release.

## GitHub Actions downloads

The `macOS package` workflow runs for pull requests targeting `dev`, pushes to
`dev`, manually (`workflow_dispatch`), or on a new `v*` tag. The branch and PR
triggers verify packages before promotion; manual dispatch becomes available
after GitHub discovers this workflow on the default branch. It uses the standard
`macos-15` Apple Silicon runner, pinned Actions,
Node 22.23.2 and `npm ci`. A tag must match `package.json` before packaging.

It tests, typechecks and lints the source, builds the Worker and native window,
validates the bundle, archives it, and launches the extracted application against
a disposable synthetic ledger on a spare loopback port. The smoke mode uses a
nonpersistent WebKit store and never opens the normal Application Support data.

The workflow retains an Actions artifact for 14 days containing:

- `HushLedger-<version>-macos-arm64.zip` with `HushLedger.app`.
- The matching `.build.json` (full version, commit, dirty-source flag, architecture,
  Node/Wrangler versions, Worker checksum and signing/notarization status).
- A `.README.txt` with installation and trust limitations.
- A `.sha256` file covering those three downloads.

Local equivalents after packaging:

```sh
npm run test:macos
npm run archive:macos
npm run smoke:macos
# After downloading all sidecars into the same directory:
shasum -a 256 -c HushLedger-<version>-macos-arm64.sha256
```

The build job has `contents: read`. For version-tag pushes, a separate release
job receives `contents: write` after the complete source gate and native smoke
pass. It validates the actual app ZIP, uploads it and its sidecars to a draft
release, then downloads and verifies every asset before publishing. It never
moves tags or deploys services. See [release instructions](RELEASING.md).

These are ad-hoc signed previews, not Developer ID signed or notarized software.
macOS may block a downloaded archive. The scripts do not remove quarantine or
bypass Gatekeeper. Build locally or use a future notarized distribution if the
preview does not meet your trust requirements.

Packaging allowlists only compiled code/assets, migrations, locale startup copy,
runtime dependencies and Node. It rejects private-state files and symlinks and
checks for embedded build-machine paths. Generated Next tracing roots use a
stable virtual `/hushledger` path. Repeated builds follow the same commands;
ZIP bytes are not promised to be bit-for-bit reproducible across SDK versions.

Four locked runtime dependency files retain public publisher CI build paths
(libvips, fsevents, Miniflare and Wrangler). The audit recognizes those exact
file/prefix pairs when GitHub's generic `/Users/runner` home overlaps them.
Actual checkout/staging roots and other private home paths are still rejected,
including within those dependency files. Their bytes are retained unchanged.

For interactive native QA only, the extracted app accepts `--smoke-test-support`
(a new directory beneath the OS temporary directory), `--smoke-test-port` (a spare
loopback port) and `--smoke-test-hold`. This retains a clearly labelled synthetic
preview window with nonpersistent WebKit storage. It never uses the ordinary
ledger or preferences. Normal archive smoke checks close automatically.

The bundled workerd requires macOS 13.5 or newer and uses the system CA store.
