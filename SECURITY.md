# Security policy

HushLedger handles sensitive personal finance data. Please do not disclose a
suspected vulnerability in a public issue.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting for this repository:

https://github.com/Coke1120/HushLedger/security/advisories/new

Include the affected version or commit, reproduction steps, expected impact,
and a minimal proof of concept that contains no real financial data or secrets.
The maintainer will acknowledge a complete report when practical, investigate
it, and coordinate a fix before public disclosure.

## Supported version

Security fixes target the latest commit on `main`. There are no long-term
support branches yet.

## Deployment responsibility

The application does not provide its own login system. Operators must protect
every production route with Cloudflare Access and configure `CF_ACCESS_TEAM_DOMAIN`
and `CF_ACCESS_AUD` as Worker secrets. The custom Worker fails closed outside
localhost and cryptographically verifies each Access JWT's signature, issuer,
audience, and lifetime before Next.js handles the request. Operators must also
keep secrets out of client bundles and the repository, enable strong authentication
on their Cloudflare account, and maintain encrypted off-platform backups. See
[docs/CLOUDFLARE_SETUP.md](docs/CLOUDFLARE_SETUP.md).

## Ledger backups and restore

The Settings JSON backup contains plaintext financial data. Its SHA-256 value is
an integrity check, not encryption, a signature, or proof of origin. Keep backup
files only in encrypted storage and never attach them to public issues, logs, test
fixtures, or pull requests. AI provider credentials and browser preferences are
not included.

Restore accepts only the current versioned HushLedger format, enforces the same-
origin and body-size boundary, validates table relationships and the checksum,
shows a no-write replacement report, and requires the literal `RESTORE` before a
transactional replacement. A trigger-maintained ledger revision is checked again
inside that D1 transaction so a stale preview cannot overwrite intervening writes.
The in-app flow is not a substitute for encrypted D1 exports, Time Travel, and
periodic recovery drills.

Account and category ordering uses the same same-origin boundary as other writes.
Each request must contain one complete status/type group and a fresh `updatedAt`
token for every member. A single guarded SQL statement applies all positions or
none, preventing a stale tab or partial API request from silently mixing orders.

## Imported CSV files

HushLedger and generic bank CSV files are decoded, parsed, and mapped in the
browser. The original file is not uploaded, persisted, logged, or sent to an AI
provider. Only normalized rows that passed local validation are sent to the
same-origin private HushLedger server for duplicate/reference preview and an
explicitly selected transactional commit. Bank source IDs are hashed before they
become import tombstones. A CSV may still contain plaintext financial data, so
store and dispose of the source file with the same care as a ledger backup.

## Payee suggestions

Payee suggestions are computed inside the private HushLedger server from saved
transactions. They are not stored in a new profile, browser storage, log, or
external service, and they are never sent to an AI provider. The response is
private and `no-store`, capped at 100 payees, and contains only the latest account
and category references needed for the new-transaction convenience. The browser
applies a remembered reference only while it remains active and the user can
override every suggested value before saving.

## User-provided AI credentials

The optional AI draft feature accepts an OpenAI-compatible base URL, API key, and
model in Settings. These values are held only in the current tab's React memory;
they must never be persisted in local/session storage, cookies, D1, Worker
globals, logs, URLs, HTML, screenshots, or test fixtures. Reloading or closing the
tab clears them.

The browser connects only to same-origin HushLedger endpoints. Route Handlers
validate Access/local authorization and Origin before proxying requests, never
forward incoming cookies or headers, append only fixed provider paths, disable
redirects, cap time and response size, and return generic errors without upstream
bodies. Production accepts public HTTPS providers on port 443 only. Local Next.js
development additionally permits loopback HTTP providers on a different port;
the production-style workerd preview keeps public-only outbound routing.
Enter only provider hostnames you trust. The local Node development server does
not DNS-pin arbitrary public hostnames, so its hostname checks cannot eliminate a
DNS-rebinding race; local use is intentionally single-user, loopback-bound, and
protected by the same-origin mutation guard. Production keeps
`global_fetch_strictly_public` enabled so Worker subrequests use the public
Internet route rather than a private zone origin.

The optional OCI image is also a local-only environment. Publish its port only
to `127.0.0.1`, never to all host interfaces, and protect the persistent `/data`
volume as financial data. The container does not add authentication or turn the
local D1 emulator into a supported public deployment; use Cloudflare Access and
Cloudflare D1 for multi-device access.

Pasted bank text is disclosed to the configured provider after the user selects
Analyze. It is kept in UI memory, is not logged or stored in D1, and model output
is treated as untrusted. Strict server validation and deterministic minor-unit
parsing occur before editable drafts are returned. Only rows explicitly reviewed
and selected by the user can enter the transactional import path; raw text and
provider credentials are never written to D1.
