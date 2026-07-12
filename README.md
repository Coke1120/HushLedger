# HushLedger

> A calm, trustworthy, privacy-first personal finance PWA.

[![CI](https://github.com/Coke1120/HushLedger/actions/workflows/ci.yml/badge.svg)](https://github.com/Coke1120/HushLedger/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-17483c.svg)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers%20%2B%20D1-f38020.svg)](docs/EASY_DEPLOY.md)

[![HushLedger ledger-and-flow brand artwork](https://raw.githubusercontent.com/Coke1120/HushLedger/main/design/brand/hushledger-social-preview.png)](https://github.com/Coke1120/HushLedger/blob/main/design/brand/hushledger-social-preview.png)

HushLedger is a single-user, online-first personal finance tool with interfaces in
Traditional Chinese, English, Japanese, and French. Built with the Next.js App
Router and deployed through OpenNext to Cloudflare Workers and D1, it focuses on
fast transaction entry, clear monthly summaries, and dependable daily, weekly,
and monthly recurring transactions.
Production deployments must be protected by Cloudflare Access.

**Live demo:** [Try HushLedger in your browser](https://hushledger-demo.howailoklineage.workers.dev/).
Use sample data only; this public deployment is not a private ledger.

You do not need to deploy HushLedger to use it. Local mode needs no Cloudflare
account, domain, Access setup, or API key. Deploy only when you want the same
private ledger available from other devices or outside your computer.

**New to deployment?** Follow the
[beginner-friendly Cloudflare guide](docs/EASY_DEPLOY.md). It requires no Git
knowledge and explains every command and dashboard click.

[![HushLedger desktop dashboard](https://raw.githubusercontent.com/Coke1120/HushLedger/main/design/qa/desktop-1440-live.png)](https://github.com/Coke1120/HushLedger/blob/main/design/qa/desktop-1440-live.png)

## Features

- Monthly income, expenses, balance, and recent transactions.
- HKD amounts stored as integer minor units to avoid floating-point errors.
- Search and income/expense filtering across the 200 most recent transactions in
  each month, with an explicit notice when the result limit is reached.
- Edit or delete an existing transaction with conflict detection if another
  session changed it first.
- Custom payees and notes.
- Daily, weekly, and monthly recurring transactions that can be created, edited,
  paused, resumed, and deleted.
- Due-transaction generation through Cloudflare Cron or a manual action, with no
  duplicate occurrence for the same rule and date.
- Stable end-of-month anchors: a January 31 rule runs on the last day of February
  and returns to March 31 instead of drifting.
- A PWA app shell, mobile bottom sheets, and responsive tablet and desktop layouts.
- Manual-by-default app updates with an opt-in automatic install-and-restart mode.
- Clear loading, demo, offline, success, and error states.
- A settings page for switching immediately among Traditional Chinese, English,
  Japanese, and French. The preference is stored only in the current browser.

Accounts and categories currently come from D1 seed data, including cash, bank,
credit card, digital wallet, income, and expense categories. Full management of
custom banks, payment accounts, income categories, and expense categories is
planned for the next phase. The existing schema already supports soft-disabling
references while preserving transaction history. See [PROJECT_BRIEF.md](PROJECT_BRIEF.md).

In HushLedger, a payment method is an account such as cash, a bank account, a
credit card, or a digital wallet. It is not an additional transaction type.

## Data invariants

- The default currency is HKD.
- HK$123.45 is stored as `12345` in `amount_minor`.
- Transactions use client-generated UUIDs, so a safe retry does not create a
  duplicate transaction.
- A transaction stores only a calendar date in `YYYY-MM-DD` format. There is no
  transaction time field.
- `created_at` and `updated_at` are internal UTC audit timestamps, not user-entered
  transaction times.
- Transaction edits preserve recurring-rule provenance and use `updated_at` as an
  optimistic concurrency token; stale updates and deletes are rejected.
- A recurring rule occurrence date is an immutable idempotency key. Editing a rule
  affects only future occurrences that have not been generated. Pausing or deleting
  a rule never deletes historical transactions.
- Every API input is validated with Zod and checked again against server-side
  account, category, and transaction-type rules.

## Architecture

```text
Cloudflare Access + custom Worker
       │ JWT, CSP, Cron
       ▼
Next.js 16 App Router via OpenNext
       │ Server Actions + Route Handlers
       ▼
Cloudflare D1
```

HushLedger does not require a separate database server, a Docker database,
third-party fonts, or an application-level login. Cloudflare Access is the
production authentication boundary.

## Choose how to run HushLedger

| Goal | Command | Database | Cloudflare required? |
| --- | --- | --- | --- |
| Use it on this computer | `npm run dev` | Local D1 | No |
| Use it without installing Node.js | Docker Desktop or Apple Container | Local D1 volume | No |
| Test the production-style Worker locally | `npm run preview` | Local D1 | No |
| Use it privately from multiple devices | `npm run deploy` | Cloudflare D1 | Yes: account, domain, and Access |

HushLedger itself does not use an application API key. Its optional AI draft
feature uses a provider key that you enter in Settings; that key stays only in
the current browser tab's memory and is cleared on reload. Local data stays in
Wrangler's ignored local state and is separate from any deployed D1 database.
After you attach its protected custom domain, a Cloudflare deployment becomes
internet-reachable, but the app must remain private behind Cloudflare Access; it
is not intended to be a public ledger.

## Languages and settings

HushLedger includes the following interface languages:

- Traditional Chinese (`zh-Hant`)
- English (`en`)
- Japanese (`ja`)
- French (`fr`)

On first use, the app selects the closest supported language from the browser
preferences. The language can be changed at any time from Settings. The selected
locale is stored only in browser local storage; it is not written to D1, sent to
the Worker, or used to create a user profile.

Dates, months, amounts, navigation, forms, status messages, and error messages use
the selected language. User-defined account names, category names, payees, notes,
and recurring-rule names are always preserved exactly as entered.

App updates are manual by default. Settings can check for a new version and install
it when you are ready. Automatic mode applies a detected version immediately and
restarts the app, so unsaved form input can be lost. This preference is stored only
in browser local storage. The updater refreshes the web app served by the current
deployment; it does not pull or replace a Docker or Apple Container image.

## Local development

This is also the supported way to use HushLedger on one computer. Requirements:
Node.js 22+ and npm 10+.

```bash
git clone https://github.com/Coke1120/HushLedger.git
cd HushLedger
npm ci
npm run db:local
```

Start Next.js. OpenNext's development bridge supplies the local D1 binding from
`wrangler.jsonc`, so only one process is needed:

```bash
npm run dev
```

Open `http://localhost:3000`. Demo data remains only in the current page session
when live data is unavailable. Mutations are blocked while offline; the app never
pretends that an offline change was synchronized.

Local mode has no application sign-in. The project script binds the server to
`127.0.0.1` only; protect your operating-system account and disk, and treat
`.wrangler/` as private financial data even though Git ignores it.

The AI draft feature also works in local mode; Cloudflare deployment is not
required. Enter the provider base URL, key, and model in Settings. Public HTTPS
providers work locally. Under `npm run dev`, you may also use a loopback provider
such as `http://127.0.0.1:<port>/v1`. A deployed Worker—and the production-style
`npm run preview` runtime—cannot reach a provider running on your computer's
localhost.

`npm run start` is intentionally not defined. A plain Next.js production server
does not provide HushLedger's Cloudflare D1 binding. Use `npm run dev` for normal
local use or `npm run preview` for the production-style OpenNext Worker running
locally.

For a production-like workerd preview using the generated OpenNext bundle:

```bash
npm run preview
```

Then open `http://localhost:8787`.

## Containerized local use

The optional container image runs the same OpenNext Worker and local D1 runtime
without installing Node.js on the host. It is for one-computer use only. Both
Docker Desktop and Apple Container build the same OCI-compatible `Dockerfile`.
Pending D1 migrations are applied automatically whenever the container starts.

Keep port `8787` bound to `127.0.0.1`. Local mode has no application login, so do
not expose this container to a LAN or the public internet. Treat its data volume
as private financial data. Use the Cloudflare deployment path for multi-device
access.

### Docker Desktop

Build the image, then create the app and its persistent named volume:

```bash
docker build --tag hushledger:local .
docker run --name hushledger --detach \
  --restart unless-stopped \
  --publish 127.0.0.1:8787:8787 \
  --volume hushledger-data:/data \
  hushledger:local
```

Open `http://127.0.0.1:8787`. Use `docker stop hushledger` and
`docker start hushledger` without losing data.

### Apple Container

[Apple Container](https://github.com/apple/container) requires Apple silicon and
macOS 26. Start its service, build the same image, create the volume once, and run
HushLedger:

```bash
container system start
container build --tag hushledger:local --file Dockerfile .
container volume create hushledger-data
container run --name hushledger --detach \
  --publish 127.0.0.1:8787:8787 \
  --volume hushledger-data:/data \
  hushledger:local
```

Open `http://127.0.0.1:8787`. Use `container stop hushledger` and
`container start hushledger` without losing data. Deleting `hushledger-data`
permanently deletes the local ledger in either runtime.

Public HTTPS AI providers work from the container. A provider running on the
host's `localhost` is intentionally not part of this local-container path.
To upgrade the containerized app, rebuild or pull the new image and replace the
container while keeping `hushledger-data`; the in-app updater cannot upgrade the
OCI image itself.

## Verification

```bash
npm run db:local
npm run verify
npm audit --omit=dev --audit-level=high
```

`npm run verify` runs the Node-based TypeScript unit suite, TypeScript typechecking,
ESLint, Oxlint, the Next.js and OpenNext production builds, and a workerd
integration gate against isolated temporary D1 databases. The gate rebuilds fresh
and upgraded migration paths and verifies the
App Router shell, privacy-safe PWA assets, security headers, API contracts,
configured Cron schedule, recurring-rule CRUD, race-safe idempotency, and history
preservation. It also starts local Next.js with a fake OpenAI-compatible provider,
verifies model discovery and a successful strict draft parse, and proves that the
parse creates no D1 transaction.

Regenerate Worker binding types after changing bindings:

```bash
npm run types:worker
```

## D1 migrations

| Migration | Purpose |
| --- | --- |
| `0001_schema.sql` | Creates the initial tables. |
| `0002_seed.sql` | Adds the initial seed data. |
| `0003_phase1_hardening.sql` | Adds constraints, indexes, UUID transactions, and the complete seed set. |
| `0004_transaction_date_only.sql` | Converts legacy transaction timestamps to calendar dates and removes the time field. |
| `0005_recurring_rules.sql` | Adds recurring rules, the generation cursor, and transaction provenance. |
| `0006_reference_localization_keys.sql` | Adds stable localization keys for built-in accounts and categories while preserving custom names verbatim. |

Apply migrations locally:

```bash
npx wrangler d1 migrations apply hushledger --local
```

Remote migrations modify production data. Confirm the Cloudflare account,
database, and backups before following the
[Cloudflare deployment guide](docs/CLOUDFLARE_SETUP.md).

## API

Successful responses use `{ "ok": true, "data": ... }`. Error responses use
`{ "ok": false, "error": { "code", "message" } }`.

```text
GET    /api/health
GET    /api/accounts
GET    /api/categories
GET    /api/transactions?month=YYYY-MM&type=expense|income&search=...
POST   /api/transactions
GET    /api/transactions/:id
PUT    /api/transactions/:id
DELETE /api/transactions/:id
GET    /api/summary?month=YYYY-MM

GET    /api/recurring-rules
GET    /api/recurring-rules/:id
POST   /api/recurring-rules
PUT    /api/recurring-rules/:id
PATCH  /api/recurring-rules/:id/status
DELETE /api/recurring-rules/:id
POST   /api/recurring-rules/run-due
```

Transactions are ordered from newest to oldest by transaction date. A response
contains at most 200 transactions. When that limit is reached, the UI explicitly
states that it is showing the 200 most recent transactions instead of describing
the truncated result as complete.

The UI performs mutations through typed, Zod-validated Server Actions. Compatibility
mutation routes remain available and require a same-origin request, a JSON content
type, a body no larger than 16 KiB, and a payload accepted by the strict schema.
These checks complement the custom Worker's cryptographic Cloudflare Access JWT validation.

## Private Cloudflare deployment

Deployment is optional. For private use on the same computer, follow
[Local development](#local-development) and stop before this section. No
HushLedger or Cloudflare API key is needed locally. A separate AI provider key is
needed only if you choose to use AI drafts.

Start with [the beginner-friendly deployment guide](docs/EASY_DEPLOY.md) if you
want a safe, copy-and-paste walkthrough with no Git experience required.

[The advanced Cloudflare guide](docs/CLOUDFLARE_SETUP.md) provides the complete
setup, including:

- Wrangler login, D1 creation, and Worker bindings.
- Local and remote migrations.
- Worker deployment and the configured daily Cron schedule.
- Cloudflare Access protection for the custom hostname and every application
  path, with alternate Worker URLs disabled.
- Unauthorized and authorized browser verification.
- Encrypted external backups and restore drills.
- AI provider networking and privacy guidance.

Do not enter real financial data until Cloudflare Access protects the custom
hostname and every path, including `/api/*`, while `workers.dev` and Preview URLs
remain disabled.

## AI bank-record drafts

The Transactions view can turn pasted plain-text online banking records into
editable drafts through a user-provided OpenAI-compatible provider:

1. Open Settings and enter the provider base URL, API key, and model ID. “Load
   models” tests `GET {baseUrl}/models`; manual model entry remains available.
2. Open Transactions, select **AI drafts**, choose the target account and date
   order, then paste at most 64 KiB of text.
3. Review every returned field. This release deliberately stops at editable
   drafts: parsing never writes a transaction or raw statement to D1.

The provider must support Chat Completions and strict `json_schema` structured
output. Browser code calls only same-origin HushLedger routes; the server appends
fixed `/models` and `/chat/completions` paths and forwards the provider request.
Enter only a provider URL you trust; local public hostnames are not DNS-pinned.
The key, provider settings, pasted text, and drafts remain in current-tab memory
and disappear on reload. They are not stored in local/session storage, cookies,
D1, service-worker caches, or logs. The pasted text is sent to the provider only
after you select **Analyze**.

OpenAI references: [API key safety](https://help.openai.com/en/articles/5112595-best-practices-for-api-key-safet),
[Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs),
and [Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).

See [AI_BANK_IMPORT_PLAN.md](AI_BANK_IMPORT_PLAN.md) for the implemented security
boundary and the still-planned atomic review/commit and duplicate-detection work.

## Privacy and security

- Never commit `.dev.vars*`, `.env*`, `.wrangler/`, local SQLite files, exports,
  backups, API keys, or real financial data.
- Never record complete amounts, payees, notes, bank records, account identifiers,
  or request bodies in logs, screenshots, issues, or pull requests.
- Never persist an AI provider key in browser storage. Reload the tab to clear the
  in-memory provider settings immediately.
- Report vulnerabilities privately according to [SECURITY.md](SECURITY.md).

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) and
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before starting, and use only fictional or
thoroughly anonymized test data.

If HushLedger is useful to you, support continued development through
[GitHub Sponsors](https://github.com/sponsors/Coke1120) or
[Buy Me a Coffee](https://buymeacoffee.com/Coke1120).

## License

[MIT](LICENSE) (c) 2026 Coke1120
