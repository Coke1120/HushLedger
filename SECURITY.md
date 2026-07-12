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
