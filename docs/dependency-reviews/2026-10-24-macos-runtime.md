# macOS ECB runtime compatibility — 2026-10-24

The ECB fetcher used `redirect: error`, which Cloudflare Workers rejects before
sending an HTTP request. It now uses `manual` and rejects every non-2xx response;
the fixed destination, timeout and response-size limits remain in place.

A separate native reproduction found that workerd 1.20260712.1 could not validate
the ECB certificate chain: `TLS peer’s certificate is not trusted; reason = unable
to get local issuer certificate`. Public Cloudflare HTTPS and HTTP succeeded.
Node 22.23.2 validated the public ECB chain, whose issuer is Sectigo Public Server
Authentication CA OV E36 / Root E46. The current observation date was 2026-10-23.

Wrangler 4.152.0 and Miniflare 5.20261019.2-beta both require workerd 1.20261019.1.
A temporary test of that exact paired binary and schema fetched the same public
ECB CSV successfully, with ordinary certificate validation. The local dependency
override now pins that version, and Worker types were regenerated. No custom CA,
TLS exception, host trust change, remote deployment or real ledger was involved.

The older hold required an ARM64 container smoke before unpinning. Full
`npm run verify` now passes on both this Apple Silicon Mac (Node 22.23.2) and an
isolated Linux ARM64 container using official node:22.23.2-bookworm-slim. Both
exercise fresh migrations 0001–0022, upgrades, financial guards, backup/restore,
Next and Worker integration. macOS additionally runs its two platform-only local
state checks. The slim Linux image needs the standard `ca-certificates` package
for this runtime; both Dockerfile stages inherit a base containing that package.
The container mounts only a source archive and is removed after execution.

The workerd binary declares macOS 13.5 as its minimum, now reflected in the app
bundle and packaging guide. Hosted Actions, signing/notarization and production
publishing have not been run.

Primary references: [Worker redirect modes](https://developers.cloudflare.com/workers/runtime-apis/request/),
[public ECB reference data](https://data-api.ecb.europa.eu/service/data/EXR/D..EUR.SP00.A?lastNObservations=1&format=csvdata).

The final full audit also identified advisories affecting bundled Undici 7.29.1:
GHSA-xjj6-f33q-929c (high, excessive content-encoding error handling),
GHSA-4qv8-2p9j-2685 and GHSA-f72v-6w45-q472 (moderate). The desktop package includes
Miniflare even though it is a development dependency for the web deployment.
A scoped `miniflare@5.20261019.2-beta -> undici 7.30.1` override applies the
compatible patched release. The explicit prerelease selector is needed for npm
to resolve that dependency correctly. The older Undici 6 dependency used
elsewhere is retained. No forced
major-version downgrade or audit suppression is used. Final audit and functional
gate outcomes are retained with the local review artifacts.

Upstream patch reference: [Undici security advisory](https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c).
