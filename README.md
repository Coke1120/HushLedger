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
- A zero-filled six-month expense trend for the selected month and previous five,
  with private-screen masking and one-tap navigation to any month in the chart.
- A ranked top-five monthly expense breakdown by category, with exact totals,
  transaction counts, and one-tap drilldown into the matching ledger records.
- Optional monthly plans on expense categories, with planned, recorded, and
  remaining-or-over amounts shown together. Plans are recurring comparison
  guardrails only: they do not reserve cash, roll balances forward, or move money.
- A selected-month forecast of active recurring entries that have not yet been
  generated, including the next date and exact occurrence count for each rule,
  plus exact scheduled income, expense, and net totals. Forecast values never
  change the recorded monthly balance before their entries are generated.
- HKD amounts stored as integer minor units to avoid floating-point errors.
- Per-account recorded, cleared, and uncleared balances at the end of the selected
  month. An optional dated opening balance anchors incomplete history, and an
  in-app month-end reconciliation workspace compares the statement against the
  exact cleared balance. It keeps the statement value only on screen, highlights
  uncleared entries for direct review, and never claims to lock the ledger. The
  same monthly account register merges ordinary transactions with both transfer
  legs and shows the exact recorded balance after every entry.
- A six-month recorded net-worth trend across every active and inactive account,
  including negative debts. Months with unknown pre-opening history are marked
  unavailable instead of silently omitting an account, and selecting a month
  opens that month throughout the overview.
- Record money moved between two accounts as one atomic transfer with independent
  source and destination posting states. Transfers stay outside income, expense,
  balance, category, plan, trend, and CSV transaction reports, so withdrawals and
  credit-card payments do not manufacture spending or income.
- Calculate a transaction amount with `+`, `-`, `*`, `/`, or parentheses. A
  bounded no-eval parser rounds only the final result before storing exact cents,
  with touch-friendly operator buttons for mobile entry.
- Stack search, income/expense, cleared/uncleared, account, and category filters
  across the 200 most recent matching transactions in each month, with inactive
  references still available for historical review and an explicit notice at the
  result limit.
- Order a monthly review by newest or oldest date, largest or smallest amount,
  or payee name. The order is strictly validated and also applies to the complete
  CSV export; blank payees remain last.
- Review the exact match count, income, expense, and net amount for the current
  transaction filters. These totals cover every match, not only the 200 rows kept
  in the interactive list.
- Save up to eight named transaction views in the current browser and reapply
  their type, clearing, account, category, search, tag, and ordering in any month.
  Saved views contain review criteria only and do not sync to Cloudflare.
- Mark transactions as cleared when they appear at the bank. Manual, duplicated,
  and recurring entries begin uncleared for review; bank imports begin cleared,
  while HushLedger CSV and full-ledger backups preserve their recorded state.
- Add case-sensitive, whitespace-delimited `#tags` to transaction notes. Tag
  chips apply an exact filter, stack with the other ledger filters, and carry
  through to the complete CSV export without adding a separate metadata store.
- Export every transaction matching the current month and filters as an
  Excel-friendly UTF-8 CSV, without the 200-row display limit and with
  user-entered spreadsheet formulas neutralized.
- Re-import HushLedger CSV files directly, or map a bank CSV's delimiter, date,
  description, signed amount or debit/credit columns, destination account, and
  fallback categories in the browser. Bank imports can reuse the latest active
  category for an exact payee and income/expense match. New rows are selected
  automatically, exact matches are flagged, and import tombstones stop the same
  source row from returning after deletion. Repeated imports can explicitly
  remember column, date, amount, and sign choices for the exact same headers in
  this browser without storing file contents, accounts, or categories.
- Download a versioned full-ledger JSON backup from Settings. Restore first shows
  a checksum-verified replacement report, then requires an explicit destructive
  confirmation before one transactional D1 replacement.
- Edit or delete an existing transaction with conflict detection if another
  session changed it first.
- Before a manual create or edit, warn when the local ledger already contains an
  exact match on type, amount, currency, account, category, date, payee, and
  note. The check returns only a count, ignores clearing status, never calls AI,
  and can be overridden because identical real purchases are valid.
- Duplicate an existing transaction into a reviewable draft with a fresh UUID;
  editable details and date are copied, while recurring/import provenance is not.
- Turn an existing manual transaction into a prefilled monthly recurring-rule
  draft; the first generation date advances to the next occurrence and nothing
  is scheduled until the reviewed rule is created.
- Create and rename accounts and categories from Settings, and disable or
  re-enable them without deleting transaction history. Arrow controls reorder
  accounts within the same status and categories within the same type/status.
  Accounts can also store an optional signed opening balance and its effective
  date; credit-card debt can therefore begin below zero without a fake expense.
  Active recurring rules and the last usable account/category are protected
  from accidental disabling.
- Custom payees and notes, with private suggestions that can reuse a known
  payee's latest still-active account and category without sending ledger data
  to a third party.
- Daily, weekly, and monthly recurring transactions that can be created, edited,
  paused, resumed, skipped once without creating a transaction, and deleted.
- Due-transaction generation through Cloudflare Cron or a manual action, with no
  duplicate occurrence for the same rule and date.
- Stable end-of-month anchors: a January 31 rule runs on the last day of February
  and returns to March 31 instead of drifting.
- A PWA app shell, mobile bottom sheets, and responsive tablet and desktop layouts.
- A one-tap screen privacy mode that masks every formatted amount, category-share
  bar, editable amount field, pasted AI bank text, and raw mapped-CSV sample for
  safer screen sharing.
- Manual-by-default app updates with an opt-in automatic install-and-restart mode.
- Clear loading, demo, offline, success, and error states.
- A settings page for switching immediately among Traditional Chinese, English,

HushLedger starts with cash, bank, credit-card, wallet, income, and expense
defaults. Settings can add custom accounts and categories, rename them, change a
custom or built-in account type, disable or re-enable entries, and persist a
preferred order without drag-and-drop. Disabled entries disappear from new
transaction choices but remain attached to history; the app intentionally offers
no destructive account/category delete action. See
[PROJECT_BRIEF.md](PROJECT_BRIEF.md).

In HushLedger, a payment method is an account such as cash, a bank account, a
credit card, or a digital wallet. It is not an additional transaction type.

## Data invariants

- The default currency is HKD.
- HK$123.45 is stored as `12345` in `amount_minor`.
- Named transaction views live only in browser storage. They include a bounded
  ordering choice but exclude the selected month, transactions, and amounts,
  are validated before reuse, and are not
  included in CSV exports or full-ledger backups.
- Transactions use client-generated UUIDs, so a safe retry does not create a
  duplicate transaction.
- Manual duplicate preflight is same-origin, read-only, and exact across type,
  amount, currency, account, category, date, payee, and note. It excludes the
  current transaction during editing, deliberately ignores clearing status, and
  warns rather than enforcing uniqueness. The explicit Duplicate action skips a
  redundant preflight because the user has already chosen to create another row.
- Duplicating a transaction opens a separate create-mode draft for review. It
  copies only editable fields, never recurring provenance, audit timestamps, or
  import identity, resets the draft to uncleared, and requires active
  account/category references.
- Existing ledgers and schema-8 backups are upgraded as cleared history. New
  manual and recurring transactions default to uncleared; reviewed bank imports
  default to cleared. This status records bank-posting review only and is not an
  irreversible reconciliation lock.
- Existing categories and schema-8/9 backups receive no monthly plan by default.
  A plan can only be a positive safe-integer HKD amount on an expense category;
  it never represents reserved or available cash.
- An account opening balance is the balance immediately before its paired
  `YYYY-MM-DD` date. The two values are both present or both null. Null means the
  app derives the balance from all recorded history; schema-8 through schema-11
  backups upgrade to that null state rather than inventing a baseline.
- Account balances include income, expenses, and both sides of transfers before
  the selected month-end cutoff. Cleared balances include only posted movements;
  the reconciliation workspace stores no statement value and does not claim an
  irreversible reconciliation lock. Changing a posting status still requires an
  explicit save through the existing transaction or transfer editor.
- Recorded net worth is the exact sum of all available signed account balances at
  each month end. Transfers therefore have zero net effect. If any account balance
  is unavailable for a month, the complete net-worth point is unavailable too.
- CSV exports include the transaction UUID for lossless round trips. Older
  HushLedger exports without that column receive stable row fingerprints during
  import; identical rows retain separate occurrence keys.
- Generic bank imports hash an optional bank transaction ID with the destination
  account. Files without IDs receive stable content-and-occurrence fingerprints;
  raw bank IDs are not stored in the tombstone key.
- A transaction stores only a calendar date in `YYYY-MM-DD` format. There is no
  transaction time field.
- `created_at` and `updated_at` are internal UTC audit timestamps, not user-entered
  transaction times.
- Transaction edits preserve recurring-rule provenance and use `updated_at` as an
  optimistic concurrency token; stale updates and deletes are rejected.
- Account transfers use client-generated UUIDs, require two distinct compatible
  accounts, and use `updated_at` conflict detection. A transfer is one atomic row,
  not a pair of income/expense transactions; its two clearing flags can represent
  money that has left one account but has not yet reached the other.
- Account activity drilldown filters transactions and transfers on the server.
  The 200-transfer display limit is applied after the account filter, rather than
  fetching an unrelated global slice and hiding rows in the browser.
- The account register orders dated opening balances, transactions, and incoming
  or outgoing transfer legs in one stable stream. When a month exceeds 200 rows,
  it returns the newest 200 but calculates every displayed running balance from
  the complete month. Activity before a dated opening balance is never presented
  as trustworthy history.
- Disabled accounts and categories are unavailable to new entries. An existing
  transaction may keep and edit against its archived references until the user
  explicitly reassigns them to active ones.
- A recurring rule occurrence date is an immutable idempotency key. Editing a rule
  affects only future occurrences that have not been generated. Pausing or deleting
  a rule never deletes historical transactions.
- Every API input is validated with Zod and checked again against server-side
  account, category, and transaction-type rules.
- Selected CSV rows are committed with a D1 transactional batch. Possible
  duplicates require an explicit checkbox; invalid or archived references are
  never silently substituted.
- Full-ledger backups cover accounts, categories, recurring rules, transactions,
  account transfers, and import tombstones. A SHA-256 checksum detects modification, and a monotonic
  ledger revision rejects restore previews that became stale before commit.

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

The eye button in the header and the matching Settings control enable screen
privacy mode for the current tab. It replaces displayed amounts with a stable
currency mask, removes category-spending proportions, masks editable amount
fields, and covers pasted bank text without hover-to-reveal behavior. Reloading
turns the mode off. This is a visual screen-
sharing aid only: it does not encrypt, delete, or alter D1 data, API responses, CSV
exports, browser memory, or text already sent to a configured AI provider.

App updates are manual by default. Settings can check for a new version and install
it when you are ready. Automatic mode applies a detected version immediately and
restarts the app, so unsaved form input can be lost. This preference is stored only
in browser local storage. The updater refreshes the web app served by the current
deployment; it does not pull or replace a Docker or Apple Container image.

## Ledger backup and restore

Settings can download one versioned JSON file containing every account, category,
recurring rule (including soft-deleted rule history), transaction, account transfer, and import
tombstone. AI provider credentials, pasted bank text, language preferences, update
preferences, saved transaction views, remembered bank CSV layouts, and screen
privacy state are intentionally excluded.

The JSON file is plaintext financial data. Store it only in encrypted storage and
do not commit, email, or attach it to an issue. Its SHA-256 checksum detects damage
or modification; it is an integrity check, not encryption or authentication.

Restore is preview-first:

1. Choose a HushLedger JSON backup of at most 7 MiB.
2. HushLedger validates the format and schema version, checksum, unique keys,
   account/category references, recurring provenance, and active reference minimums.
3. Review the current-versus-backup row counts for all six tables.
4. Download a fresh backup, then type `RESTORE` to enable the destructive action.
5. HushLedger rechecks the live ledger revision and replaces every table in one D1
   transaction. A stale preview or any constraint failure writes nothing.

The in-app format is for practical personal-ledger portability and restores only
the schema version supported by the running build. For a backup larger than 7 MiB,
long-term disaster recovery, or a database-level archive, use the encrypted Wrangler
D1 export, restore, and recovery process in
[the advanced Cloudflare guide](docs/CLOUDFLARE_SETUP.md#7-back-up-and-test-recovery).

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
configured Cron schedule, reference-data lifecycle and safety guards,
recurring-rule CRUD, race-safe idempotency, and history preservation. It proves
that transfers leave total net worth unchanged, incomplete opening-balance
history is exposed, and a filtered CSV export is not truncated by the interactive
200-row limit. It
also starts local Next.js with a fake
OpenAI-compatible provider, verifies model discovery and a successful strict
draft parse, proves that parsing creates no D1 transaction, then verifies an
explicit preview/commit, stable re-analysis identity, and a deleted-import
tombstone.
The same gate exports and restores a complete six-table JSON ledger, upgrades
schema-11 backups with no invented opening balances, schema-10 backups with no invented transfers, schema-9 backups with neither
invented transfers nor category plans, and schema-8 backups with cleared legacy
history, rejects a modified checksum and a
stale preview, and proves that the final re-export exactly matches the pre-restore
data.

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
| `0007_transaction_import_keys.sql` | Adds source-key tombstones for duplicate-safe CSV and reviewed AI imports; keys deliberately survive transaction deletion. |
| `0008_ledger_revision.sql` | Adds a monotonic ledger revision maintained by table triggers so restore previews cannot overwrite newer writes. |
| `0009_transaction_clearing_status.sql` | Adds cleared/uncleared bank-posting status, preserving existing history as cleared. |
| `0010_category_monthly_plans.sql` | Adds optional positive monthly spending plans to expense categories without implying reserved cash or rollover. |
| `0011_account_transfers.sql` | Adds atomic account-to-account transfers with independent source and destination posting states and backup revision triggers. |
| `0012_account_opening_balances.sql` | Adds optional signed, dated account opening balances with database guards requiring the amount and date together. |

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
GET    /api/accounts/balances?month=YYYY-MM  (recorded, cleared, and uncleared balances at month end)
GET    /api/accounts/register?month=YYYY-MM&accountId=ID  (merged monthly activity with exact running balances)
GET    /api/reports/net-worth?month=YYYY-MM  (six complete-or-unavailable month-end net-worth points)
POST   /api/accounts
PATCH  /api/accounts  (reorder one complete active/inactive group)
GET    /api/accounts/:id
PUT    /api/accounts/:id
PATCH  /api/accounts/:id
GET    /api/categories
POST   /api/categories
PATCH  /api/categories  (reorder one complete type/status group)
GET    /api/categories/:id
PUT    /api/categories/:id
PATCH  /api/categories/:id
GET    /api/payee-suggestions  (latest references for up to 100 known payees)
GET    /api/transactions?month=YYYY-MM&type=expense|income&status=cleared|uncleared&accountId=1&categoryId=3&search=...&tag=Trip&sort=amount_desc
GET    /api/transactions/summary?month=YYYY-MM&type=expense|income&status=cleared|uncleared&accountId=1&categoryId=3&search=...&tag=Trip
POST   /api/transactions
POST   /api/transactions/duplicates  (exact local-ledger match count; no transaction contents)
GET    /api/transactions/:id
PUT    /api/transactions/:id
DELETE /api/transactions/:id
GET    /api/transfers?month=YYYY-MM[&accountId=ID]  (latest 200 matching account transfers)
POST   /api/transfers
GET    /api/transfers/:id
PUT    /api/transfers/:id
DELETE /api/transfers/:id
GET    /api/exports/transactions?month=YYYY-MM&type=expense|income&status=cleared|uncleared&accountId=1&categoryId=3&search=...&tag=Trip&sort=amount_desc
GET    /api/backups/ledger  (versioned full-ledger JSON attachment)
POST   /api/backups/ledger  (preview or explicitly confirmed transactional restore)
GET    /api/summary?month=YYYY-MM  (totals, six-month expense trend, ranked categories, and remaining recurring entries)

GET    /api/recurring-rules
GET    /api/recurring-rules/:id
POST   /api/recurring-rules
PUT    /api/recurring-rules/:id
PATCH  /api/recurring-rules/:id/status
POST   /api/recurring-rules/:id/skip
DELETE /api/recurring-rules/:id
POST   /api/recurring-rules/run-due
POST   /api/ai/models
POST   /api/imports/parse  (create untrusted AI drafts; never writes D1)
POST   /api/imports/ai  (preview or commit reviewed AI drafts, maximum 200 rows)
POST   /api/imports/csv  (preview or commit normalized HushLedger/bank CSV rows, maximum 200)
```

Item-level account/category `PATCH` changes `isActive`; collection-level `PATCH`
reorders one complete account status group or category type/status group. `PUT`
renames an entry and may also change an account type or its paired opening
balance/date. Mutations use `updatedAt`
for optimistic concurrency. Reordering normalizes positions in one guarded SQL
statement, so a stale or partial list writes nothing. There is no account/category
`DELETE`: disabling preserves historical foreign-key links, and the server rejects
disabling the last active choice or a choice used by an active recurring rule.

Transactions default to newest-first and accept only the documented date,
amount, or payee ordering values. A response contains at most 200 transactions.
When more rows match, the UI states exactly
how many are visible out of the complete result. The adjacent filtered summary
uses a separate order-independent aggregate query over every match, so its count, income, expense,
and signed net are not truncated by the list limit. The optional `status` filter
is shared by the aggregate and uncapped CSV export.

Transfers are a separate ledger surface because movement between owned accounts
must not affect income or expense reporting. New transfers require two active HKD
accounts. Editing preserves an existing archived source or destination, uses the
same optimistic `updatedAt` guard as transactions, and records source and
destination posting independently. Transfer routes are strict, same-origin, and
never included in transaction CSV exports.

Account balance aggregation is read-only and uses the end of the requested month
as an exclusive cutoff. It includes transfers in each account but never feeds
them back into income, expense, category, plan, trend, or CSV totals. A statement
value entered in the UI stays in component memory only and is compared with the
cleared balance; it is not sent to an API or written to D1.

The account register is also read-only. Its starting balance uses the dated
opening balance plus every earlier recorded movement inside that account's known
history. A dated opening inside the selected month appears as the first trusted
entry; months entirely before that date remain unavailable. The endpoint merges
both sides of transfers without converting them into income or expense and uses
stable date, creation-time, and ID ordering for same-day entries.

Payee suggestions are derived on demand from existing transactions and are never
sent to an AI provider or another service. Suggestions are separated by income
and expense, ordered by recent use, and capped at 100. A new transaction only
reuses the latest account or category when that reference is still active; the
user can always replace either choice before saving. Generic bank imports can
optionally apply the same exact-match category memory while keeping the selected
destination account. No payee rule or additional tracking table is created.

The transaction export route returns a downloadable UTF-8 CSV rather than the
JSON success envelope. It applies the same month, filters, and ordering, is
not restricted to 200 rows, and appends `Transaction ID` plus `Cleared` for
deterministic round trips. Import parses the file in the browser. HushLedger exports open
directly; other headered UTF-8 bank CSVs offer comma, semicolon, or tab delimiters,
five numeric date formats, one signed amount or separate debit/credit columns,
optional sign reversal, an optional source ID, explicit account/category defaults,
and optional exact payee-category reuse. The server receives normalized rows only,
previews duplicate/reference checks, and writes only explicitly selected rows.
Users can explicitly remember up to eight exact-header CSV layouts in browser
storage. A layout contains only column indexes, date format, amount mode, sign,
and the payee-category reuse preference; it excludes filenames, transaction rows,
accounts, and categories. Unchecking the option before preview forgets that layout.
This convenience round trip is not a complete database backup. Use the Settings
JSON backup for app-level full-ledger portability, and the encrypted D1 export
and restore process in the [advanced Cloudflare guide](docs/CLOUDFLARE_SETUP.md#7-back-up-and-test-recovery)
for database-level disaster recovery.

The ledger backup `GET` is the other successful response without the normal JSON
envelope. The restore `POST` uses the normal envelope, a separate 8 MiB request
ceiling, strict same-origin validation, a dry-run report, checksum verification,
typed `RESTORE` confirmation, and a revision guard inside the D1 transaction.

The UI performs mutations through typed, Zod-validated Server Actions. Compatibility
mutation routes remain available and require a same-origin request, a JSON content
type, a body no larger than 16 KiB, and a payload accepted by the strict schema.
The CSV and reviewed-AI import routes each have a separate 256 KiB validated
request ceiling for up to 200 parsed rows. These checks complement the custom Worker's cryptographic
Cloudflare Access JWT validation.

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
3. Review every returned field. Parsing never writes a transaction or raw
   statement to D1.
4. HushLedger checks the edited rows against the live ledger. New rows are
   selected by default; possible duplicates require an explicit selection.
   Select **Save selected transactions** to commit the reviewed set atomically.

The provider must support Chat Completions and strict `json_schema` structured
output. Browser code calls only same-origin HushLedger routes; the server appends
fixed `/models` and `/chat/completions` paths and forwards the provider request.
Enter only a provider URL you trust; local public hostnames are not DNS-pinned.
The key, provider settings, pasted text, and unsaved drafts remain in current-tab
memory and disappear on reload. They are not stored in local/session storage,
cookies, D1, service-worker caches, or logs. The pasted text is sent to the
provider only after you select **Analyze**. Saving sends only the validated,
edited transaction fields to HushLedger; D1 retains a one-way source key and
transaction ID so re-analysis, including after deletion, does not silently
restore the same source row.

OpenAI references: [API key safety](https://help.openai.com/en/articles/5112595-best-practices-for-api-key-safet),
[Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs),
and [Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).

See [AI_BANK_IMPORT_PLAN.md](AI_BANK_IMPORT_PLAN.md) for the implemented security,
duplicate-review, idempotency, and atomic-commit boundary.

## Privacy and security

- Never commit `.dev.vars*`, `.env*`, `.wrangler/`, local SQLite files, exports,
  backups, API keys, or real financial data.
- Treat downloaded JSON backups as plaintext financial data even when their
  SHA-256 integrity check passes; keep them in encrypted storage.
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
