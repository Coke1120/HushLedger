# HushLedger

> A calm, trustworthy, privacy-first personal finance PWA.

[![CI](https://github.com/Coke1120/HushLedger/actions/workflows/ci.yml/badge.svg)](https://github.com/Coke1120/HushLedger/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-17483c.svg)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers%20%2B%20D1-f38020.svg)](docs/EASY_DEPLOY.md)

[![HushLedger ledger-and-flow brand artwork](https://raw.githubusercontent.com/Coke1120/HushLedger/main/design/brand/hushledger-social-preview.png)](https://github.com/Coke1120/HushLedger/blob/main/design/brand/hushledger-social-preview.png)

HushLedger is a single-user, online-first personal finance tool with interfaces in
Traditional Chinese, English, Japanese, and French. Built as a React PWA backed by
Cloudflare Workers and D1, it focuses on fast transaction entry, clear monthly
summaries, and dependable daily, weekly, and monthly recurring transactions.
Production deployments must be protected by Cloudflare Access.

**New to deployment?** Follow the
[beginner-friendly Cloudflare guide](docs/EASY_DEPLOY.md). It requires no Git
knowledge and explains every command and dashboard click.

[![HushLedger desktop dashboard](https://raw.githubusercontent.com/Coke1120/HushLedger/main/design/qa/desktop-1440-live.png)](https://github.com/Coke1120/HushLedger/blob/main/design/qa/desktop-1440-live.png)

## Features

- Monthly income, expenses, balance, and recent transactions.
- HKD amounts stored as integer minor units to avoid floating-point errors.
- Search and income/expense filtering across the 200 most recent transactions in
  each month, with an explicit notice when the result limit is reached.
- Custom payees and notes.
- Daily, weekly, and monthly recurring transactions that can be created, edited,
  paused, resumed, and deleted.
- Due-transaction generation through Cloudflare Cron or a manual action, with no
  duplicate occurrence for the same rule and date.
- Stable end-of-month anchors: a January 31 rule runs on the last day of February
  and returns to March 31 instead of drifting.
- A PWA app shell, mobile bottom sheets, and responsive tablet and desktop layouts.
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
- A recurring rule occurrence date is an immutable idempotency key. Editing a rule
  affects only future occurrences that have not been generated. Pausing or deleting
  a rule never deletes historical transactions.
- Every API input is validated with Zod and checked again against server-side
  account, category, and transaction-type rules.

## Architecture

```text
React 19 + Vite 8 + TypeScript PWA
                  |
                  v
       Cloudflare Worker + Hono
                  |
                  v
             Cloudflare D1
```

HushLedger does not require a separate database server, a Docker database,
third-party fonts, or an application-level login. Cloudflare Access is the
production authentication boundary.

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

## Local development

Requirements: Node.js 22+ and npm 10+.

```bash
git clone https://github.com/Coke1120/HushLedger.git
cd HushLedger
npm ci
npm run db:local
```

Start the Worker and Vite in separate terminals:

```bash
# Terminal A: Worker, API, and local D1
npm run dev:worker
```

```bash
# Terminal B: Vite; proxies /api to 127.0.0.1:8787
npm run dev
```

Open `http://localhost:5173`. If only Vite is running, the app enters a clearly
labelled demo mode. Demo data remains only in the current page session. Mutations
are blocked while offline; the app never pretends that an offline change was
synchronized.

For a production-like preview served by one Worker:

```bash
npm run build
npm run dev:worker
```

Then open `http://localhost:8787`.

## Verification

```bash
npm run db:local
npm run verify
npm audit --omit=dev --audit-level=high
```

`npm run verify` runs Vitest, TypeScript, ESLint, Oxlint, a production PWA build,
and a Worker integration gate against an isolated temporary D1 database. The
integration gate rebuilds fresh and upgraded migration paths and verifies the API,
configured Cron schedule, recurring-rule CRUD, race-safe idempotency, and history
preservation.

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

Mutation routes require a same-origin browser request, a JSON content type, a body
within the configured size limit, and a payload accepted by the strict schema.
These application checks do not replace Cloudflare Access.

## Private Cloudflare deployment

Start with [the beginner-friendly deployment guide](docs/EASY_DEPLOY.md) if you
want a safe, copy-and-paste walkthrough with no Git experience required.

[The advanced Cloudflare guide](docs/CLOUDFLARE_SETUP.md) provides the complete
setup, including:

- Wrangler login, D1 creation, and Worker bindings.
- Local and remote migrations.
- Worker deployment and the configured daily Cron schedule.
- Cloudflare Access protection for the self-hosted application and alternate
  hostnames.
- Unauthorized and authorized browser verification.
- Encrypted external backups and restore drills.
- The correct location for future AI provider secrets.

Do not enter real financial data until Cloudflare Access protects the UI,
`/api/*`, the custom domain, `workers.dev`, and preview URLs.

## Planned AI bank-record import

After the core workflow is stable, HushLedger plans to support pasted plain-text
online banking records. A user-provided OpenAI-compatible base URL and API key will
parse the text into editable drafts. AI output will never write directly to D1;
only transactions that the user explicitly reviews and confirms will pass through
the deterministic minor-unit import pipeline.

See [AI_BANK_IMPORT_PLAN.md](AI_BANK_IMPORT_PLAN.md) for the provider adapter,
security boundary, duplicate-detection approach, and test matrix. The current
release does **not** enable AI and does not accept an API key in the browser.

## Privacy and security

- Never commit `.dev.vars*`, `.env*`, `.wrangler/`, local SQLite files, exports,
  backups, API keys, or real financial data.
- Never record complete amounts, payees, notes, bank records, account identifiers,
  or request bodies in logs, screenshots, issues, or pull requests.
- Store Worker secrets with `wrangler secret put`. There are no `VITE_` secrets.
- Report vulnerabilities privately according to [SECURITY.md](SECURITY.md).

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) and
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before starting, and use only fictional or
thoroughly anonymized test data.

## License

[MIT](LICENSE) (c) 2026 Coke1120
