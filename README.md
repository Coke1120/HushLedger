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
monthly, and yearly recurring transactions and account transfers.
Production deployments must be protected by Cloudflare Access.

**Beta:** HushLedger is actively developed. Review release changes and back up
before updating an installation with financial data.
Read the [changelog](CHANGELOG.md) before upgrading an existing deployment.

## Get started

- **Try it:** [Open the live demo](https://hushledger-demo.howailoklineage.workers.dev/)
  to explore an explicit read-only sample ledger. It never accepts edits.
- **Use it on one computer:** [Set up local mode](#local-development), or use
  [Docker Desktop or Apple Container](#containerized-local-use). Local mode needs
  no Cloudflare account, domain, Access setup, or AI provider key.
- **Use it privately across devices:** Follow the
  [beginner-friendly Cloudflare deployment guide](docs/EASY_DEPLOY.md). It explains
  every command and dashboard step, including the required Access protection.

Once your private ledger is running, follow [Your first session](#your-first-session).

[![HushLedger desktop dashboard](https://raw.githubusercontent.com/Coke1120/HushLedger/main/design/qa/desktop-1440-live.png)](https://github.com/Coke1120/HushLedger/blob/main/design/qa/desktop-1440-live.png)

## Features

- Record income and expenses quickly on a phone or desktop, with an amount
  calculator, reusable payees, and conflict-aware editing.
- Understand a month through cash-flow trends, income and spending breakdowns,
  optional category plans, and recorded account balances.
- Review and reconcile history with precise filters, saved views, posting states,
  duplicate checks, and a complete account-register export.
- Import bank CSV files through a local mapping and review flow, or optionally use
  your own AI provider to turn pasted bank text into editable drafts.
- Schedule recurring income, expenses, and transfers without duplicate ledger
  occurrences. Scheduling records entries; it never moves money at a bank.
- Keep accounts in their native currencies. Reports cover the selected reporting
  currency; optional reference rates do not convert recorded amounts.
- Use Traditional Chinese, English, Japanese, or French, with responsive layouts
  and a screen privacy control that masks displayed amounts while sharing.
- Keep a portable ledger with complete JSON backups and a preview-first restore
  that checks for changes before replacing data.

See the [feature reference](docs/FEATURES.md) for detailed behavior and limits.

## Your first session

After local setup or the deployment guide's privacy check:

1. **Choose the reporting currency first.** A fresh ledger starts in HKD. Open
   Settings before adding transactions, imports, transfers, recurring rules,
   opening balances, category plans, or an emergency-fund checkpoint. Those records
   lock this choice. Changing a pristine ledger also relabels its existing
   accounts; it does not convert money.
2. **Set up your accounts and categories.** Rename the defaults or add the accounts
   you use. Choose each new account's native currency carefully; it cannot be
   edited individually later. If you are starting partway through an account's
   history, set its signed opening balance and date before importing later entries.
3. **Record one transaction and check it.** Add income or an expense, confirm it
   appears in Transactions and the selected month's Overview, then reload to check
   that it was saved. Use an account in the reporting currency for this first check;
   other currencies are excluded from the overview totals.
4. **Bring in more history when ready.** Review the bank CSV import preview before
   saving selected rows. Mark entries cleared when they appear on your statement;
   record movements between owned accounts as transfers.
5. **Prepare your first backup.** In Settings, download the full-ledger JSON and
   keep it in encrypted storage. Follow the [backup and restore guide](#ledger-backup-and-restore)
   for validation and recovery; preparing a download alone does not prove the copy
   was retained or is recoverable.

You maintain the installation: apply updates, back up before migrations, and test
recovery using a separate ledger. A deployed ledger also needs its Cloudflare
Access protection maintained. Start with the
[operational backup guidance](docs/CLOUDFLARE_SETUP.md#7-back-up-and-test-recovery).

## Data invariants

- A fresh ledger defaults to HKD. Each account has an immutable native currency;
  transactions, imports, recurring rules, opening balances, and same-currency
  transfers follow it. Settings can choose AED, AUD, CAD, CHF, CNY, CZK, DKK, EUR,
  GBP, HKD, ILS, INR, MOP, MXN, MYR, NOK, NZD, PHP, PLN, QAR, SAR, SEK, SGD, THB,
  TRY, TWD, USD, or ZAR; every supported currency uses two decimal minor units in
  HushLedger.
- The default/reporting currency can change only while the ledger has no
  transactions, transfers, recurring transaction or transfer rules, import
  tombstones, opening balances, category plans, or emergency-fund checkpoint. A
  change relabels that pristine ledger and never converts amounts or applies an
  exchange rate. Until conversion exists, dashboard totals and net worth include
  only the reporting currency.
- ECB reference rates are optional, explicitly user-requested public data. They
  are stored as immutable EUR-base decimal-text observations with their ECB date
  and local fetch time, are included in backups, and never alter original amounts.
- An amount of 123.45 is stored as `12345` in `amount_minor`.
- Named transaction views live only in browser storage. They include the bounded
  transaction date scope and ordering choice. A custom range stores its exact
  inclusive endpoints, while selected-month views exclude a particular month.
  Views never contain transactions; an optional exact amount criterion is stored
  as a validated minor-unit integer. Legacy saved views default the structured
  import-checklist filter to all states. Views are validated before reuse and are
  not included in CSV exports or full-ledger backups.
- Transaction queries default to the selected month. `scope=range` requires one
  valid, ordered `dateFrom`/`dateTo` pair and includes both endpoints;
  `scope=all` removes the date bound. Either wider scope affects only the
  ordinary transaction list, its filtered aggregate, and CSV export; monthly
  financial reports and account calculations remain anchored to `month`.
- Transactions use client-generated UUIDs, so a safe retry does not create a
  duplicate transaction.
- Manual duplicate preflight is same-origin, read-only, and exact across type,
  amount, currency, account, category, date, payee, and note. It excludes the
  current transaction during editing, deliberately ignores clearing status, and
  warns rather than enforcing uniqueness. The explicit Duplicate action skips a
  redundant preflight because the user has already chosen to create another row.
  The possible-duplicate review filter uses the same fields, shows every member
  of an exact-match group, and never merges or deletes automatically.
- Duplicating a transaction opens a separate create-mode draft for review. It
  copies only editable fields, never recurring provenance, audit timestamps, or
  import identity, resets the draft to uncleared, and requires active
  account/category references.
- Existing ledgers and schema-8 backups are upgraded as cleared history. New
  manual and recurring transactions default to uncleared; reviewed bank imports
  default to cleared. This status records bank-posting review only and is not an
  irreversible reconciliation lock.
- Existing categories and schema-8/9 backups receive no monthly plan by default.
  A plan can only be a positive safe-integer amount in the ledger currency on an
  expense category; it never represents reserved or available cash.
- An account opening balance is the balance immediately before its paired
  `YYYY-MM-DD` date. The two values are both present or both null. Null means the
  app derives the balance from all recorded history; schema-8 through schema-11
  backups upgrade to that null state rather than inventing a baseline.
- Account balances include income, expenses, and both sides of transfers before
  the selected month-end cutoff. Cleared balances include only posted movements,
  and the uncleared count treats each transfer side independently;
  the reconciliation workspace stores no statement value and does not claim an
  irreversible reconciliation lock. A complete uncleared review is loaded only
  after an explicit same-origin request, verifies its exact row count, and remains
  in current-screen memory. Each inline posting-status change is account-bound and
  concurrency-checked; changing a transfer updates only the selected account's leg.
- The ledger stores at most one emergency-fund checkpoint, backed by one active
  cash, bank, or wallet account in the ledger currency. Progress uses that
  account's recorded month-end balance only: negative balances contribute zero,
  and progress above the target is capped at the target. The checkpoint is not an
  envelope, reserved or available cash, a recommendation, a deadline, or an
  automated transfer.
- Recorded net worth is the exact sum of all available signed account balances at
  each month end. Transfers therefore have zero net effect. If any account balance
  is unavailable for a month, the complete net-worth point is unavailable too.
- Transaction CSV exports include the transaction UUID for lossless round trips. Older
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
- Bulk clearing accepts only explicit transaction IDs paired with their
  `updated_at` versions, is bounded to 200 rows, and runs as one guarded SQL
  statement. A missing or stale row makes the complete update fail without a
  partial posting-status change. Its route-specific 32 KiB body cap accommodates
  all 200 canonical UUID/version pairs while remaining independently bounded.
- Bulk recategorization uses the same explicit, bounded conflict tokens and a D1
  transactional batch. The target must be active and match every selected
  transaction type; `RETURNING` verifies the exact rows without counting the
  ledger-revision trigger as another transaction update.
- Account transfers use client-generated UUIDs, require two distinct compatible
  accounts, and use `updated_at` conflict detection. A transfer is one atomic row,
  not a pair of income/expense transactions; its two clearing flags can represent
  money that has left one account but has not yet reached the other. Generated
  transfers also retain an immutable rule-name, due-date, and occurrence-key
  snapshot that ordinary transfer edits cannot replace.
- Account activity drilldown filters transactions and transfers on the server.
  The 200-transfer display limit is applied after the account filter, rather than
  fetching an unrelated global slice and hiding rows in the browser.
- The account register orders dated opening balances, transactions, and incoming
  or outgoing transfer legs in one stable stream. When a month exceeds 200 rows,
  it returns the newest 200 but calculates every displayed running balance from
  the complete month. Its explicit all-uncleared action calculates running balances
  over all known activity through the cutoff before returning every uncleared row,
  verifies the exact count, and has no 200-row cap. A separate same-origin CSV action
  re-reads every matching range entry without that display cap and orders them
  oldest-first for review. Activity before a dated opening balance is never
  presented as trustworthy history.
- Disabled accounts and categories are unavailable to new entries. An existing
  transaction may keep and edit against its archived references until the user
  explicitly reassigns them to active ones.
- A recurring rule occurrence date is an immutable idempotency key. Editing a rule
  affects only future occurrences that have not been generated. Pausing or deleting
  a rule never deletes historical transactions or transfers.
- A recurring rule end date is inclusive: an occurrence may be generated on that
  date, and the rule is complete only after its generation cursor advances beyond it.
- Every API input is validated with Zod and checked again against server-side
  account, category, and transaction-type rules.
- Selected CSV rows are committed with a D1 transactional batch. A unique exact
  match links and clears the existing transaction in that same batch. Possible
  or ambiguous duplicates require an explicit checkbox; invalid or archived
  references are never silently substituted.
- Full-ledger backups cover the ledger currency, accounts, categories, the
  emergency-fund checkpoint, recurring transaction and transfer rules, transactions,
  account transfers, import tombstones, and saved ECB reference-rate observations.
  A SHA-256 checksum detects modification, and a monotonic ledger revision rejects
  restore previews that became stale before commit.

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
feature uses a provider key that you enter in Settings. You can use it only in the
current tab or explicitly persist it as AES-GCM ciphertext in D1. Browser and API
responses expose only redacted settings metadata; AI proxy routes decrypt a saved
key server-side. Local data stays in Wrangler's ignored local state and is separate
from any deployed D1 database.
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
currency mask, removes spending-breakdown proportions, masks editable amount
fields and exact-amount filter descriptions, and covers pasted bank text without
hover-to-reveal behavior. It turns on
automatically when the tab is hidden or the app loses focus, then restores the
user's prior choice on return. Reloading clears the manual choice. This is a visual screen-
sharing aid only: it does not encrypt, delete, or alter D1 data, API responses, CSV
exports, browser memory, or text already sent to a configured AI provider.

App updates are manual by default. Settings can check for a new version and install
it when you are ready. Automatic mode applies a detected version immediately and
restarts the app, so unsaved form input can be lost. This preference is stored only
in browser local storage. The updater refreshes the web app served by the current
deployment; it does not pull or replace a Docker or Apple Container image.

## Ledger backup and restore

Settings can download one versioned JSON file containing the ledger currency and
every account, category, optional emergency-fund checkpoint, recurring transaction
or transfer rule (including soft-deleted rule history), transaction, account transfer, and import
tombstone, plus any explicitly fetched ECB reference-rate observations. AI provider settings, pasted bank text, language preferences,
update preferences, saved transaction views, remembered bank CSV layouts, and
screen privacy state are intentionally excluded.

This app-level backup exclusion does not remove saved AI settings from the D1
database. A database export or Time Travel history can retain the settings row,
with the API key represented as ciphertext rather than plaintext.

The JSON file is plaintext financial data. Store it only in encrypted storage and
do not commit, email, or attach it to an issue. Its SHA-256 checksum detects damage
or modification; it is an integrity check, not encryption or authentication.

Settings records, in this browser only, when HushLedger last prepared a backup
download and successfully validated a backup. It warns after 30 days without
a download. These dates are a maintenance reminder, not proof that the file was
retained or stored safely.

Restore is preview-first:

1. Choose a HushLedger JSON backup of at most 7 MiB.
2. HushLedger validates the format and schema version, checksum, unique keys,
   account/category references, recurring provenance, and active reference minimums.
3. Review the current-versus-backup row counts for all nine collections.
4. Download a fresh backup, then type `RESTORE` to enable the destructive action.
5. HushLedger rechecks the live ledger revision and replaces the currency and all
   nine ledger collections in one D1 transaction. A stale preview or any
   constraint failure writes nothing.

After a successful replacement, HushLedger removes saved transaction views from
that browser and synchronizes the removal to other open tabs, so payee, search,
tag, account, and category filters from the previous ledger cannot be applied to
unrelated restored data. Other browser-only preferences remain unchanged. If the
browser refuses the cleanup, the committed restore remains intact and HushLedger
warns the user to clear the site's browser data before reloading or reusing saved
views.

The in-app format is for practical personal-ledger portability. The running build
writes schema 20 and accepts schemas 8 through 20. Schema 8 through schema 19
backups upgrade in memory; schema 8 through schema 13 default the ledger currency
to HKD, while schema 8 through schema 12 also upgrade without inventing an
emergency-fund checkpoint. Their existing version-specific defaults for clearing
state, monthly plans, transfers, and opening balances still apply. Schema-14 through
schema-20 restores carry their currency with the rest of the ledger instead of
converting any amount. Only schemas 15–20 can contain yearly recurring transaction
rules, only schemas 16–20 can store their end dates, and only schemas 17–20 store
scheduled-transfer rules and generated-transfer provenance. Schemas 18–20 preserve
the structured import-review state; older backups reconstruct imported rows from
their surviving import keys as unreviewed without assigning a state to manual rows.
Schema 20 also preserves optional ECB reference-rate observations; older backups
upgrade with an empty observation list and never invent rates.
For a
backup larger than 7 MiB, long-term disaster recovery,
or a database-level archive, keep Wrangler D1 exports in encrypted off-platform
storage and follow the restore and recovery process in
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

Open `http://localhost:3000`. If the live ledger cannot be loaded, any displayed
snapshot remains read-only. Mutations are blocked while offline; the app never
substitutes writable demo data or pretends that an offline change was synchronized.

`npm run dev` deliberately retires any HushLedger service worker on that origin
and removes only HushLedger or legacy Workbox app-shell caches. Next.js development
chunk URLs can remain stable across edits, so keeping the production cache-first
worker would risk loading old application code after a restart. This cleanup does
not touch D1, local storage, IndexedDB, or ledger data. Use `npm run preview` when
testing the production offline shell and in-app update workflow.

Local mode has no application sign-in. The project script binds the server to
`127.0.0.1` only; protect your operating-system account and disk, and treat
`.wrangler/` as private financial data even though Git ignores it. On macOS and
Linux, the supported `dev`, `preview`, and `db:local` scripts repair its POSIX
modes to `0700` directories and `0600` files before use. They reject links that
could redirect the repair outside the state tree, and macOS ACLs are removed. An
inherited `0077` umask removes group/other mode access from subsequently created
entries. Direct Next or Wrangler commands bypass this protection. Windows folder
ACLs are not changed; keep the checkout inside your private user profile and
protect the disk.

The AI draft feature also works in local mode; Cloudflare deployment is not
required. Enter the provider base URL, key, and model in Settings. Public HTTPS
providers work locally. Under `npm run dev`, you may also use a loopback provider
such as `http://127.0.0.1:<port>/v1`. A deployed Worker—and the production-style
`npm run preview` runtime—cannot reach a provider running on your computer's
localhost.

Memory-only AI use needs no encryption secret. To persist provider settings in
the local D1 database, add one freshly generated 64-character hexadecimal value
to the Git-ignored `.dev.vars` file:

```dotenv
AI_SETTINGS_ENCRYPTION_KEY_V1=<output of openssl rand -hex 32>
```

Run `openssl rand -hex 32` locally, paste its output after `=`, and never commit
the file or value. Replacing or losing this key makes existing saved credentials
undecryptable; enter and save the provider key again after an intentional change.

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
without installing Node.js on the host. It is a private local deployment, not a
public server. Both Docker Desktop and Apple Container build the same
OCI-compatible `Dockerfile`.
The build context excludes local `.env*` and Wrangler `.dev.vars*` secrets.
Pending D1 migrations are applied automatically whenever the container starts.

Keep port `8787` bound to `127.0.0.1`. Local mode has no application login, so do
not expose this container to a LAN or the public internet. Treat its data volume
as private financial data. Container startup removes group/other POSIX mode access
from `/data` before migrations run.

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

### Access from another Tailscale computer

Keep the container bound to `127.0.0.1`; do not change the publish address to
`0.0.0.0`. On the other computer, open an SSH tunnel through the tailnet to a
host with SSH enabled:

```bash
ssh -N -L 8787:127.0.0.1:8787 user@hushledger-host
```

Replace `user@hushledger-host` with the Docker host's SSH user and Tailscale
MagicDNS name or IP, keep the tunnel running, then open
`http://127.0.0.1:8787` on that computer. Local mode has no application login,
so restrict SSH access with the tailnet policy and host permissions.

Do not use Tailscale Funnel. A direct Tailscale Serve URL is not currently
supported because HushLedger's local-access bypass accepts only loopback
hostnames; use the SSH tunnel or the private Cloudflare deployment path.

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
the generated Worker binding-type freshness check, ESLint, Oxlint, the Next.js and
OpenNext production builds, and a workerd
integration gate against isolated temporary D1 databases. The gate rebuilds fresh
and upgraded migration paths and verifies the
App Router shell, privacy-safe PWA assets, security headers, API contracts,
configured Cron schedule, reference-data lifecycle and safety guards,
recurring-rule CRUD, race-safe idempotency, and history preservation. It proves
that transfers leave total net worth unchanged, incomplete opening-balance
history is exposed, and neither filtered transaction CSV nor account-register
CSV export is truncated by the interactive 200-row page size. It
also starts local Next.js with a fake
OpenAI-compatible provider, verifies model discovery and a successful strict
draft parse, proves that parsing creates no D1 transaction, then verifies an
explicit preview/commit, stable re-analysis identity, and a deleted-import
tombstone.
The same gate exports and restores a complete schema-20 JSON ledger, including its
currency and nine data collections, and verifies schema-8 through schema-19
compatibility. Pre-schema-14 backups upgrade to HKD.
Schema-14 and older backups retain their existing daily, weekly, or monthly recurring
rules without inventing a yearly frequency, and schema-15 and older rules receive no
invented end date. Schema-12 and older backups
never invent an emergency-fund checkpoint; schema-11 and older backups also
receive no invented opening balance, schema-10 and older backups receive no
invented transfer, schema-9 and older backups receive no invented category plan,
and schema-8 history upgrades as cleared. Schema-17 and older backups reconstruct
imported rows as unreviewed from surviving import keys. The gate rejects a
modified checksum and a stale preview, and proves that the final re-export exactly
matches the pre-restore data.

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
| `0013_emergency_fund_goal.sql` | Adds one optional account-backed emergency-fund checkpoint and ledger-revision triggers without reserving or moving money. |
| `0014_ledger_currency.sql` | Adds one ledger-wide two-decimal currency setting, migrates existing ledgers as HKD, cascades pristine currency changes across dependent rows, and blocks relabeling after monetary history exists. |
| `0015_yearly_recurring_rules.sql` | Allows yearly recurring rules while preserving existing schedules and generated-transaction provenance. |
| `0016_recurring_rule_end_dates.sql` | Adds optional inclusive end dates so recurring rules can complete automatically without deleting generated history. |
| `0017_recurring_transfer_rules.sql` | Adds scheduled account-transfer rules plus immutable generated-transfer provenance while preserving manual transfers and report neutrality. |
| `0018_import_review_status.sql` | Adds a nullable three-state local checklist for imported transactions, backfilling rows with surviving import keys as unreviewed while leaving manual rows unchanged. |
| `0019_multi_currency_accounts.sql` | Preserves native currencies per account and dependent monetary rows, while keeping the ledger currency as a reporting currency until explicit conversion is added. |
| `0020_ecb_reference_rates.sql` | Adds immutable, explicitly fetched EUR-base ECB reference-rate observations without modifying ledger money. |
| `0021_ai_provider_settings.sql` | Adds single-row AI provider settings with an AES-GCM ciphertext, IV, and encryption-key version; app ledger backups deliberately exclude this row. |

Apply migrations locally:

```bash
npm run db:local
```

Remote migrations modify production data. Confirm the Cloudflare account,
database, and backups before following the
[Cloudflare deployment guide](docs/CLOUDFLARE_SETUP.md).
Apply `0021_ai_provider_settings.sql` before deploying code that persists AI
settings.

## API

Successful responses use `{ "ok": true, "data": ... }`. Error responses use
`{ "ok": false, "error": { "code", "message" } }`.

```text
GET    /api/health
GET    /api/ledger-settings  (ledger currency and whether it can still change)
PUT    /api/ledger-settings  (conflict-safe pristine-ledger currency change; no conversion)
GET    /api/exchange-rates/ecb  (locally retained ECB EUR-base reference-rate observations)
POST   /api/exchange-rates/ecb  (explicitly fetch the fixed ECB CSV source; never automatic)
GET    /api/accounts
GET    /api/accounts/balances?month=YYYY-MM  (month-end balances and exact uncleared-entry counts)
GET    /api/accounts/register?month=YYYY-MM&accountId=ID  (merged monthly activity with exact running balances)
POST   /api/accounts/register/uncleared  (explicit uncapped uncleared snapshot through a cutoff; JSON body)
PATCH  /api/accounts/register/clearing  (account-bound optimistic status update for one transaction or transfer leg)
GET    /api/reports/net-worth?month=YYYY-MM  (six complete-or-unavailable month-end net-worth points)
GET    /api/emergency-fund-goal  (the optional account-backed checkpoint, or null)
PUT    /api/emergency-fund-goal  (create or conflict-safe update)
DELETE /api/emergency-fund-goal  (conflict-safe removal)
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
POST   /api/transactions/query  (primary private query; JSON filters in the body; returns capped rows plus the uncapped summary)
GET    /api/transactions?...  (legacy compatibility; URL query filters, latest 200 rows)
GET    /api/transactions/summary?...  (legacy compatibility; URL query filters, uncapped aggregate)
POST   /api/transactions
POST   /api/transactions/duplicates  (exact local-ledger match count; no transaction contents)
PATCH  /api/transactions/category  (atomic category update for 1-200 same-type, explicitly versioned rows)
PATCH  /api/transactions/clearing  (atomic cleared/uncleared update for 1-200 explicitly versioned rows)
PATCH  /api/transactions/import-review  (atomic checklist update for 1-200 explicitly versioned imported rows)
GET    /api/transactions/:id
PUT    /api/transactions/:id
DELETE /api/transactions/:id
GET    /api/transfers?month=YYYY-MM[&accountId=ID]  (latest 200 matching account transfers)
POST   /api/transfers
GET    /api/transfers/:id
PUT    /api/transfers/:id
DELETE /api/transfers/:id
POST   /api/exports/transactions  (primary private CSV export; JSON filters in the body)
POST   /api/exports/account-register  (complete account/range reconciliation CSV; JSON query in the body)
POST   /api/backups/ledger  (`export`: same-origin versioned full-ledger JSON attachment)
POST   /api/backups/ledger  (`preview` or `commit`: preview or explicitly confirmed transactional restore)
GET    /api/summary?month=YYYY-MM  (monthly totals and reports plus a current Hong Kong-date 35-day recurring outlook; includes legacy monthly recurrence fields for cached clients)

GET    /api/recurring-rules
GET    /api/recurring-rules/:id
POST   /api/recurring-rules
PUT    /api/recurring-rules/:id
PATCH  /api/recurring-rules/:id/status
POST   /api/recurring-rules/:id/skip
DELETE /api/recurring-rules/:id
POST   /api/recurring-rules/run-due
GET    /api/recurring-transfer-rules
GET    /api/recurring-transfer-rules/:id
POST   /api/recurring-transfer-rules
PUT    /api/recurring-transfer-rules/:id
PATCH  /api/recurring-transfer-rules/:id/status
POST   /api/recurring-transfer-rules/:id/skip
DELETE /api/recurring-transfer-rules/:id
POST   /api/recurring-transfer-rules/run-due
GET    /api/ai-settings  (redacted saved-provider metadata only; never returns key material)
PUT    /api/ai-settings  (conflict-safe encrypted persistence; requires the Worker encryption secret)
DELETE /api/ai-settings  (removes saved settings; does not revoke the upstream provider key)
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
disabling the last active choice, a choice used by an active recurring transaction
rule, or either account used by an active scheduled transfer.

Transactions default to newest-first and accept only the documented date,
amount, or payee ordering values. A private query response contains at most 200
transactions and an optional continuation cursor held only in current React
memory. The cursor is bound to the parsed filters, exact ordering tuple, and the
trigger-maintained D1 ledger revision; a changed ledger rejects continuation and
refreshes page one instead of mixing snapshots. The UI states exactly how many
rows are loaded out of the complete result and loads another page only after an
explicit action. The cursor is a private-UI consistency guard, not an authorization
token; Cloudflare Access and the same-origin boundary remain authoritative. The
first-page filtered summary uses a separate order-independent
aggregate query over every match, so its count, income, expense, and signed net
are not truncated by the page size. Monthly and
filtered reports fail closed if otherwise-valid entries would combine beyond
JavaScript's exact safe-integer range; HushLedger never returns a rounded money
total as if it were exact. The optional `status` filter is shared by the aggregate
and uncapped CSV export.

Transfers are a separate ledger surface because movement between owned accounts
must not affect income or expense reporting. New transfers require two active
accounts in the ledger currency. Editing preserves an existing archived source or
destination, uses the same optimistic `updatedAt` guard as transactions, and
records source and destination posting independently. Transfer routes are strict,
same-origin, and never included in transaction CSV exports. Scheduled generation
uses the same native transfer row, leaves both posting states uncleared, preserves
its rule/date provenance, and remains outside income and expense reporting.

Account balance aggregation is read-only and uses the end of the requested month
as an exclusive cutoff. It includes transfers in each account but never feeds
them back into income, expense, category, plan, trend, or CSV totals. A statement
value entered in the UI stays in component memory only and is compared with the
cleared balance; it is not sent to an API or written to D1.

The normal account-register query is read-only. Its starting balance uses the
dated opening balance plus every earlier recorded movement inside that account's
known history. A dated opening inside the selected range appears as the first
trusted entry; ranges entirely before that date remain unavailable. The endpoint
merges both sides of transfers without converting them into income or expense and
uses stable date, creation-time, and ID ordering for same-day entries.

The complete uncleared review is a separate explicit same-origin JSON `POST`, not
an automatic widening of the normal range. One database statement calculates
running balances over all known activity through the requested close date before
filtering uncleared rows, returns an exact count with no interactive cap, and fails
closed if the count or money invariants disagree. The response is private and
`no-store`; the browser keeps it only in the open reconciliation screen and clears
it when the account, dates, mode, or screen changes. Its narrow clearing mutation
requires the account, source ID, kind, and optimistic `updatedAt` version. For a
transfer it writes only the displayed account's clearing flag, never the opposite
leg or unrelated editable fields.

The account-register export uses the same calculation but removes only the
interactive 200-entry cap. It adds an explicit `range_start` balance row when the
range has a trustworthy starting balance, then writes every ledger entry oldest-
first with exact signed decimal movement and running balance. Transfer rows contain
only the selected account's leg and retain that leg's clearing state. The route is
same-origin JSON `POST` only, names files with a numeric account ID and exact range,
and returns formula-neutralized plaintext CSV; screen privacy does not mask or
encrypt the downloaded values. It is deliberately not accepted by transaction CSV
import, and complete restore remains the versioned JSON ledger backup.

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
deterministic round trips. Export requires an explicit same-origin JSON `POST`,
keeps financial filters out of the URL, and leaves `GET` unavailable so a
cross-site top-level navigation cannot trigger a plaintext download. Import
parses the file in the browser. HushLedger exports open
directly; other headered UTF-8 bank CSVs offer comma, semicolon, or tab delimiters,
five numeric date formats, one signed amount or separate debit/credit columns,
optional sign reversal, an optional source ID, explicit account/category defaults,
and optional exact payee-category reuse. Each mapped row's category remains
editable until a fresh duplicate/reference preview; changing it clears the old
selection while preserving the bank source identity. The server receives normalized
rows only and writes only explicitly selected rows. It
matches only a cleared import with one unique, field-identical uncleared entry;
the imported source key is attached to that existing transaction before it is
cleared, while zero or multiple candidates remain possible duplicates.
Users can explicitly remember up to eight exact-header CSV layouts in browser
storage. A layout contains only column indexes, date format, amount mode, sign,
and the payee-category reuse preference; it excludes filenames, transaction rows,
accounts, and categories. Unchecking the option before preview forgets that layout.
This convenience round trip is not a complete database backup. Use the Settings
JSON backup for app-level full-ledger portability, and the encrypted D1 export
and restore process in the [advanced Cloudflare guide](docs/CLOUDFLARE_SETUP.md#7-back-up-and-test-recovery)
for database-level disaster recovery.

The ledger backup `POST` export mode is the other successful response without the
normal JSON envelope. It requires an explicit same-origin JSON action; `GET` is
unavailable so a cross-site top-level navigation cannot trigger a plaintext file
download. Restore modes use the normal envelope, a separate 8 MiB request ceiling,
strict same-origin validation, a dry-run report, checksum verification, typed
`RESTORE` confirmation, and a revision guard inside the D1 transaction.

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
- The AI-settings encryption Worker secret, networking, and privacy guidance.

Do not enter real financial data until Cloudflare Access protects the custom
hostname and every path, including `/api/*`, while `workers.dev` and Preview URLs
remain disabled.

## AI bank-record drafts

The Transactions view can turn pasted plain-text online banking records into
editable drafts through a user-provided OpenAI-compatible provider:

1. Open Settings and enter the provider base URL, API key, and model ID. Keep the
   values in this tab or explicitly save them. “Load models” tests
   `GET {baseUrl}/models`; manual model entry remains available.
2. Open Transactions, select **AI drafts**, choose the target account and date
   order, then paste at most 64 KiB of text.
3. Review every returned field. Parsing never writes a transaction or raw
   statement to D1.
4. HushLedger checks the edited rows against the live ledger. New rows and unique
   exact matches to one uncleared entry are selected by default; possible or
   ambiguous duplicates require an explicit selection.
   Select **Save selected transactions** to commit the reviewed set atomically.

The provider must support Chat Completions and strict `json_schema` structured
output. Browser code calls only same-origin HushLedger routes; the server appends
fixed `/models` and `/chat/completions` paths and forwards the provider request.
Enter only a provider URL you trust; local public hostnames are not DNS-pinned.
Transient settings, pasted text, and unsaved drafts remain in current-tab memory
and disappear on reload. Explicitly saved settings persist the base URL and model
in D1 and the API key only as AES-GCM ciphertext encrypted with the independent
operator-managed Worker secret. Browser and settings API responses return only
redacted metadata; the AI proxy routes load and decrypt the saved key server-side.
Neither mode stores the plaintext key in browser storage, cookies, service-worker
caches, or logs. The pasted text is sent to the provider only after you select
**Analyze**. Saving reviewed transactions sends only validated, edited fields to
HushLedger; D1 retains a one-way source key and transaction ID so re-analysis,
including after deletion, does not silently restore the same source row.

The full-ledger JSON backup excludes AI settings. D1 exports and Time Travel can
retain the ciphertext row. Deleting saved settings does not revoke the upstream
credential; rotate or revoke it with the provider when immediate invalidation is
required.

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
- Never persist an AI provider key in browser storage. Use transient tab memory or
  the encrypted D1 settings flow; rotate or revoke the upstream key after exposure.
- Report vulnerabilities privately according to [SECURITY.md](SECURITY.md).

## Contributing

Issues and pull requests are welcome. Read the
[current product priorities](docs/PRODUCT_REVIEW.md), [CONTRIBUTING.md](CONTRIBUTING.md),
and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before starting, and use only fictional
or thoroughly anonymized test data.

If HushLedger is useful to you, support continued development through
[GitHub Sponsors](https://github.com/sponsors/Coke1120) or
[Buy Me a Coffee](https://buymeacoffee.com/Coke1120).

## License

[MIT](LICENSE) (c) 2026 Coke1120
