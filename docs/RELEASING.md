# Releases with a macOS application

Publish releases through the macOS package workflow by pushing a new version
tag from the verified current main commit. Do not publish a source-only release
manually. The build must include the approved native packaging source, and the
tag must exactly match package.json. Never move an existing release tag.

The workflow uses GitHub's macos-15 Apple Silicon runner and standalone Node
22.23.2. It performs the complete application verification gate, release guard
tests, native lifecycle tests, packaging, ad-hoc signature verification, archive
creation, and an extracted native app launch/quit with a disposable synthetic
ledger. No user ledger or MacBook is used.

The release ZIP is checked for the actual HushLedger.app: bundle identity and
version, executable permissions and arm64 Mach-O headers for the app, Node and
workerd, signature resources, icon, locale messages, runtime, compiled Worker,
web assets and migrations. Its embedded provenance must agree with the download
sidecar, the exact clean source commit and tag, architecture and Worker checksum.

A separate job receives contents: write only after the build succeeds. It uses
GitHub's REST API with GITHUB_TOKEN, creates or resumes a draft release, and
uploads four downloads:

- HushLedger-VERSION-macos-arm64.zip, containing HushLedger.app.
- The matching .build.json with full version/source/runtime/signing provenance.
- A .README.txt describing installation and trust limitations.
- A .sha256 covering the other three downloads.

The job downloads every uploaded asset and verifies its actual bytes and size
against the local validated build. It checks the remote tag and current main
again before publishing. A failed upload or verification leaves the release a
draft. A rerun can reuse matching draft assets, but refuses conflicting assets
or an already published release; it never deletes assets or replaces tags.
Cross-host download redirects do not receive the GitHub token.

Before pushing the tag, merge the reviewed version and release-note changes,
wait for main's complete CI and macOS package jobs, and verify the intended
commit. Use the preferred Git identity when authoring release changes or tags.
After the tag run, check the published release's four assets and the workflow's
verification result. The Actions artifact retained for 14 days is a preview
download; it is not a substitute for attached release assets.

The current desktop distribution is Apple Silicon-only, requires macOS 13.5+
and is ad-hoc signed, without Developer ID signing or notarization. The workflow
does not remove quarantine or bypass Gatekeeper. Interactive import/export and
other native UI QA beyond the automated smoke must be reported separately.

Python 3 is required for release guard tests and publication in CI. No Python
runtime is bundled into the application or required on the destination Mac.
