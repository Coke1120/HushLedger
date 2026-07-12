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
parsing occur before editable drafts are returned. The current draft feature has
no D1 write path.
