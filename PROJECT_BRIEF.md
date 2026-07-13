# HushLedger product brief

> Updated: 2026-07-13 (HKT)
>
> Status: core transaction and recurring-rule release implemented locally
>
> Product languages: Traditional Chinese (`zh-Hant`), English (`en`), Japanese
> (`ja`), and French (`fr`)

## Goal

HushLedger is a low-maintenance, private income and expense tracker for one
person across phone, tablet, and desktop. It prioritizes trustworthy data,
quick daily entry, and calm presentation over accounting-suite complexity.

```text
Cloudflare Access + custom Worker
       │ authenticated OpenNext fetch + Cron
       ▼
Next.js App Router
       │ Server Actions + Route Handlers
       ▼
Cloudflare D1
```

Production is online-first and protected by Cloudflare Access. The project does
not operate an independent database server or a multi-user identity system.

## Core user journeys

### Review a month

- View income, expense, and balance in the ledger's selected currency for a
  selected month.
- Compare a zero-filled six-month recorded cash-flow trend across income,
  expenses, and net movement, then select any month to review that calendar
  month; hide relative bar heights when privacy mode is enabled.
- Review the top five expense categories or named payees by exact total and
  transaction count; select one to open the corresponding exact transaction
  filter without turning a payee into a broad text search.
- Compare optional monthly expense-category plans with recorded spending and the
  exact remaining-or-over amount. Roll up every plan into total planned spending,
  spending recorded in planned categories, the net difference, and spending
  outside plans; treat all of these as recurring guardrails, not cash allocation,
  rollover, or envelope balances.
- Review one optional emergency-fund checkpoint against the recorded month-end
  balance of one active cash, bank, or wallet account in the ledger currency.
  Treat it only as a user-chosen progress comparison: it does not create or
  reserve money, recommend an amount or deadline, forecast future funds, automate
  transfers, or verify a provider balance.
- Review active recurring entries that remain ungenerated in the selected month
  as an expandable chronological list of every scheduled date, rule name,
  optional payee, amount, and income/expense label. Group those exact dates into
  fixed seven-day periods starting on day 1, including zero periods and a final
  period that may be shorter. Keep exact income, expense, and net forecast totals separate from
  recorded or available balance, and direct the user to the provider statement
  for the actual date and amount.
- Browse the latest 200 matching transactions for the selected month, a one-click
  fixed range of 12 complete calendar months through it, any other inclusive
  fixed date range, or all history; the UI explicitly discloses the cap when it
  is reached. Widening the transaction date scope does not change monthly reports
  or account math.
- Search payee, note, account, or category.
- Organize notes with case-sensitive, whitespace-delimited `#tags`; select a tag
  from a transaction to apply an exact filter that also scopes CSV export.
- Stack income/expense, cleared/uncleared, account, category, and exact payee
  filters; retain inactive references as historical filter choices and clear
  incompatible category filters when the selected transaction type changes.
- Explicitly select shown transactions to change their clearing state together,
  or move a same-type selection to an active matching category. Bound each batch
  to 200 conflict-tokened rows and leave every row untouched when any selected
  version or target-category invariant fails.
- Order the current transaction scope by date, amount, or payee in either
  direction while keeping the default newest-first overview and blank payees last.
- Show exact count, income, expense, and signed net for every transaction matching
  the current filters, independently of the interactive 200-row display cap.
- Save up to eight validated, named date-scope, filter, and ordering combinations
  in the current browser and reapply them without storing a particular month,
  transaction amounts, or cloud metadata.
- Export all transactions matching the selected date scope and filters as CSV
  without the interactive 200-row limit; keep disaster-recovery backups separate.
- Import a HushLedger CSV directly, or locally map a headered bank CSV's delimiter,
  date/description/amount fields, target account, and fallback categories before
  duplicate preview, explicit row selection, and a transactional commit of at
  most 200 normalized rows.
- Download a complete versioned JSON ledger, validate a restore without writing,
  compare replacement counts, and require a typed confirmation before one atomic
  replacement. Keep the latest backup-preparation and integrity-check dates in
  this browser only, with a reminder after 30 days without a download.
- Mask formatted amounts, category proportions, editable amount fields, pasted
  bank text, and raw mapped CSV samples with a current-tab screen privacy control
  before sharing the screen; force the mask while the app is hidden or unfocused,
  then restore the user's prior in-memory choice.
- Switch the interface language in Settings; keep the preference in the current
  browser only.
- Choose one ledger-wide currency in Settings before monetary history exists.
  Keep it in private D1 data and full-ledger backups; do not fetch exchange rates,
  convert amounts, or imply multi-currency accounting.

### Record money

- Add income or expense in a short responsive form.
- Record a withdrawal, card payment, or movement between owned accounts as one
  atomic transfer, with separate “left source” and “reached destination” states;
  never classify that movement as income or expense.
- Leave manual entries uncleared until they appear at the bank, or mark them
  cleared during entry or review. Duplicated and recurring entries also begin
  uncleared; reviewed bank imports begin cleared. Show each account's exact
  still-uncleared entry count through the selected month-end so a zero net does
  not hide offsetting items, and count transfer posting state per account side.
- Calculate an amount with touch-friendly arithmetic operators or a typed
  expression; parse without `eval` and round only the final result to minor units.
- Save and close a valid transaction from any dialog field with `Ctrl+Enter` or
  `Command+Enter`; expose the shortcut on the enabled Save control and leave
  global single-letter keys to the browser and assistive technology.
- Correct or delete an existing transaction; reject stale changes made from an
  out-of-date view.
- Duplicate an existing transaction into a separate reviewable draft when a
  one-off entry should be repeated without creating a recurring rule. Preserve
  its editable details and date, but issue a fresh UUID and omit provenance.
- Start a reviewed monthly recurring-rule draft from an existing manual
  transaction, with the first generation date advanced to the next occurrence;
  transactions already generated by a rule cannot create a second schedule.
- Choose an active account and a matching income or expense category.
- Create, rename, disable, re-enable, and reorder accounts and categories in
  Settings without deleting historical references.
- Add a custom payee or note; choose a previous payee to reuse its latest active
  account and category without an external service.
- Select a calendar date only; no transaction-time field exists.
- Receive explicit success, error, demo, and offline feedback.

### Automate predictable entries

- Create a daily, weekly, or monthly recurring rule.
- Set name, type, amount, account, category, schedule date, payee, note, and
  active state.
- Modify, pause, resume, skip exactly one next occurrence, or delete the rule.
- Require the displayed next date and revision when skipping so a Cron race or
  stale tab cannot silently skip a different occurrence; create no transaction.
- Generate due transactions from Cloudflare Cron or the authenticated manual
  action.
- Preserve generated history when a rule changes or is deleted.
- Use the overview forecast to see every ungenerated occurrence in the selected
  month in stable date order, with an explicit expansion control, exact monthly
  totals, and fixed day-1-anchored seven-day cash-flow periods. Generated ledger
  entries remain part of actual totals instead, and forecast money never becomes
  recorded or available balance by presentation alone. Scheduled dates are
  ledger-generation dates, not verified provider due dates or payment
  confirmations.

## Data contract

### Ledger currency

Migration `0014_ledger_currency.sql` adds one D1-backed currency for the complete
ledger. Fresh and upgraded ledgers start as HKD. Settings can change a pristine
ledger to AED, AUD, CAD, CHF, CNY, CZK, DKK, EUR, GBP, HKD, ILS, INR, MOP, MXN,
MYR, NOK, NZD, PHP, PLN, QAR, SAR, SEK, SGD, THB, TRY, TWD, USD, or ZAR. Every
supported currency uses two decimal minor units in HushLedger.

The database rejects a currency change after any transaction, transfer, recurring
rule, import tombstone, account opening balance, category plan, or emergency-fund
checkpoint exists. A permitted change cascades through the otherwise-pristine
accounts. It relabels the ledger and never fetches an exchange rate or converts an
amount.

### Transactions

```text
id                    client-generated UUID
type                  income | expense
amount_minor          positive integer minor units
currency              the ledger-wide supported currency
account_id            active compatible account
category_id           active matching category
occurred_on           YYYY-MM-DD calendar date
cleared               bank-posting review state
payee                 optional custom text
note                  optional custom text
recurring_rule_id     nullable provenance
recurring_rule_name   nullable immutable name snapshot
recurrence_due_on     nullable immutable scheduled date
created_at            internal UTC audit timestamp
updated_at            internal UTC audit timestamp
```

An amount of 123.45 is stored as `12345`. Binary floating point is never
authoritative.
`occurred_on` is intentionally date-only; audit timestamps must not be presented
as transaction time. `cleared` is a reversible review marker, not an immutable
reconciliation lock. `updated_at` is also the optimistic concurrency token for
editing and deleting a transaction. Edits never replace recurring provenance.
Before a manual create or edit, a same-origin, read-only preflight returns only
the count of exact matches across type, amount, currency, account, category,
date, payee, and note. Editing excludes its own row and clearing status is
deliberately ignored. A match warns but never blocks a legitimate identical
transaction, and no ledger data leaves the Worker for this check.

### Accounts and categories

The default seed supports cash, bank, credit card, wallet, income categories,
and expense categories. Settings and the API support custom creation, rename,
account-type changes, and reversible disable/re-enable operations. Mutations use
`updated_at` conflict tokens. The last active account or category of a transaction
type cannot be disabled, nor can a reference used by an active recurring rule.
Foreign keys and the absence of hard-delete routes preserve transaction history.
Disabled references are excluded from new transactions and rules, while an
existing transaction can retain and edit its original archived references.
Accessible arrow controls reorder accounts within an active/inactive group and
categories within a type plus active/inactive group. The server requires the
complete group with fresh conflict tokens and normalizes its positions in one
guarded statement, so stale or partial requests write nothing.

In product wording, a custom `payment` item means a payment-method account such
as cash, bank, credit card, or wallet. It is not a separate transaction or
account type in the current data model.

### Emergency-fund checkpoint

Migration `0013_emergency_fund_goal.sql` adds at most one checkpoint row. It
references one active cash, bank, or wallet account in the ledger currency,
stores a positive target in integer minor units, and uses `updated_at` for
conflict-safe updates and deletion. The overview compares that target with the
selected month's recorded month-end balance. A negative recorded balance
contributes zero to progress, and progress above the target is capped at the target.

The checkpoint is not a separate balance, envelope, reserve, availability claim,
recommendation, completion date, forecast, provider verification, or transfer
instruction. Removing it does not alter the backing account or any ledger entry.

### Account transfers

```text
id                 client-generated UUID
amount_minor       positive integer minor units
currency           the ledger-wide supported currency
from_account_id    source account
to_account_id      distinct destination account
occurred_on        YYYY-MM-DD calendar date
from_cleared       source posting-review state
to_cleared         destination posting-review state
note               optional custom text
created_at         internal UTC audit timestamp
updated_at         optimistic concurrency token
```

A transfer is one atomic record, not paired income and expense rows. It is omitted
from monthly totals, category reports, plans, trends, and transaction CSV export.
New records require two active compatible accounts; an existing record may retain
its archived references while being reviewed or corrected.

### Recurring rules

- Frequencies: `daily`, `weekly`, `monthly`.
- A schedule retains its original numeric day anchor. A January 31 monthly rule
  clamps to February's last day and returns to March 31.
- Creating a rule with a past start does not create historical entries; its
  first due date is the first matching date on or after the current date in the
  application's configured timezone.
- Existing active rules catch up missed Cron dates with a bounded batch.
- Paused dates are skipped when a rule resumes.
- Generated occurrences use a database unique key, user-facing revision, and
  internal scheduler cursor version to withstand retries and races.
- Editing affects only ungenerated dates. Soft deletion never removes generated
  transactions.

## API surface

```text
GET    /api/health
GET    /api/ledger-settings
PUT    /api/ledger-settings  (conflict-safe pristine-ledger change; no conversion)
GET    /api/accounts
GET    /api/emergency-fund-goal
PUT    /api/emergency-fund-goal  (create or conflict-safe update)
DELETE /api/emergency-fund-goal  (conflict-safe removal)
POST   /api/accounts
PATCH  /api/accounts
GET    /api/accounts/:id
PUT    /api/accounts/:id
PATCH  /api/accounts/:id
GET    /api/categories
POST   /api/categories
PATCH  /api/categories
GET    /api/categories/:id
PUT    /api/categories/:id
PATCH  /api/categories/:id
GET    /api/payee-suggestions
POST   /api/transactions/query  (primary private body query; ordered 200 plus uncapped aggregate)
GET    /api/transactions?...  (legacy URL-query compatibility; ordered 200)
GET    /api/transactions/summary?...  (legacy URL-query compatibility; uncapped aggregate)
POST   /api/transactions
POST   /api/transactions/duplicates  (exact match count only)
PATCH  /api/transactions/category  (atomic same-type category update for 1-200 versioned rows)
PATCH  /api/transactions/clearing  (atomic clearing update for 1-200 versioned rows)
GET    /api/transactions/:id
PUT    /api/transactions/:id
DELETE /api/transactions/:id
GET    /api/transfers?month=YYYY-MM
POST   /api/transfers
GET    /api/transfers/:id
PUT    /api/transfers/:id
DELETE /api/transfers/:id
POST   /api/exports/transactions  (primary private body query; uncapped CSV)
POST   /api/imports/csv  (preview or commit, 200 rows maximum)
POST   /api/ai/models
POST   /api/imports/parse  (draft only; zero D1 writes)
POST   /api/imports/ai  (preview or commit reviewed drafts, 200 rows maximum)
POST   /api/backups/ledger  (`export`: same-origin versioned full-ledger JSON attachment)
POST   /api/backups/ledger  (`preview` or `commit`: preview or confirmed transactional restore)
GET    /api/summary?month=YYYY-MM

GET    /api/recurring-rules
GET    /api/recurring-rules/:id
POST   /api/recurring-rules
PUT    /api/recurring-rules/:id
PATCH  /api/recurring-rules/:id/status
POST   /api/recurring-rules/:id/skip
DELETE /api/recurring-rules/:id
POST   /api/recurring-rules/run-due
```

Responses use one success/error envelope except the CSV and ledger-backup download
attachments. API input is strict Zod-validated;
the server independently validates amount, currency, account state, category
state, category type, content type, body size, and same-origin mutation.
Database and stack errors are never returned to the client.

The transaction export is a successful non-JSON response: an attachment
with UTF-8 BOM, exact signed decimal amounts, CRLF records, formula-safe user
text, a stable transaction UUID, and clearing status. It requires a same-origin
JSON `POST`, keeps filters out of URLs, and rejects `GET` navigation so another
site cannot initiate a plaintext download. Import parses that contract
in the browser,
resolves account/category names without guessing, previews exact matches and
conflicts against D1, and writes selected rows in a transactional batch. Import
keys intentionally survive transaction deletion to prevent an accidental
re-import. CSV remains a portable transaction view, not a full D1 backup or
restore format.

The schema-14 ledger JSON format covers the ledger currency and seven collections:
accounts, categories, the emergency-fund checkpoint, recurring rules,
transactions, account transfers, and import tombstones. It excludes browser
preferences and AI credentials. Its SHA-256
checksum detects modification. Restore validates internal references, returns a
no-write current-versus-backup report, requires `RESTORE`, and rechecks a
trigger-maintained ledger revision inside the same D1 transaction before replacing
the currency and all seven collections. Schema-8 through schema-13 backups remain
compatible and upgrade to HKD; schema-8 through schema-12 do not invent an
emergency-fund checkpoint. Schema-14 restores preserve the selected currency and
never convert amounts. The in-app file limit is 7 MiB;
larger or database-level recovery uses Wrangler D1 export and restore. The browser
stores only the most recent backup-preparation and integrity-check dates; this
reminder does not prove that a backup file was retained off-platform.

## Reliability and privacy

- Cloudflare Access protects every production UI and API hostname, and the custom
  Worker cryptographically verifies its signed JWT before forwarding to Next.js.
- The Cloudflare account uses strong authentication and MFA.
- Repository, logs, fixtures, screenshots, issues, and pull requests contain no
  secrets or real financial data.
- Local secret-bearing `.dev.vars*` and `.env*` files stay outside Git and
  container build contexts;
  `.wrangler/`, local databases, exports, and backups are ignored by Git. Supported
  host and container commands also remove group/other POSIX mode access before use,
  set a restrictive creation mask, and remove inherited macOS ACLs from host state.
- D1 is not the only copy: maintain encrypted off-platform backups and periodic
  restore drills.
- Warn after 30 days without preparing an in-app backup download, while keeping
  that maintenance record browser-local and treating it only as a reminder.
- In-app JSON backups are plaintext. Their checksum proves integrity only, not
  confidentiality or authenticity. Export requires an explicit same-origin JSON
  `POST`; `GET` stays unavailable so cross-site navigation cannot trigger a
  plaintext download into a browser or synchronized Downloads folder.
- Only the production non-sensitive offline/demo shell and fingerprinted static
  assets may be cached. API, Server Action, RSC, personalized navigation, and
  financial responses are never cached. Development retires any existing app
  worker and deletes only HushLedger or legacy Workbox shell caches so stable
  development chunk URLs cannot return old code. Offline writes and multi-device
  conflict sync are not claimed.
- Screen privacy is explicitly visual and current-tab only. It never claims to
  encrypt D1, API payloads, exports, browser memory, or provider-bound bank text.

## UX direction

- Calm warm-white canvas, forest-green identity, restrained income and expense
  colors, and a system font stack that supports all four product languages.
- Phone-first quick entry with a bottom sheet; useful tablet and desktop width.
- A Settings page with immediate language switching and local-only preference
  persistence.
- One D1-backed ledger currency selected before monetary history exists, with no
  exchange-rate lookup, conversion, or per-account currency mode.
- An optional emergency-fund checkpoint configured in Settings and reviewed on
  the monthly overview with explicit recorded-balance and non-reservation wording.
- A persistent header indicator for temporary screen privacy, with no hover or
  focus path that reveals the masked amount.
- History-safe account and category management with clear inactive states and
  no destructive delete affordance.
- Optional positive monthly plans on expense categories, editable with the
  category and visible beside current-month actual spending without suggesting
  that funds were reserved.
- Preview-first HushLedger and mapped-bank CSV import that defaults possible
  duplicates to unselected and never sends the source file to an AI provider.
- Preview-first full-ledger restore with visible replacement counts, typed
  destructive confirmation, no partial-write path, and removal of saved transaction
  views that belonged to the replaced ledger.
- Semantic HTML, visible focus, keyboard navigation, focus restore, disclosed
  context-local shortcuts, 44 px touch targets, sufficient contrast, and
  field-linked errors.
- No fake navigation, decorative charts, remote fonts, marketing hero, or
  hidden failure state.

## Delivery status

### Complete core

- D1 schema, seed, constraints, indexes, date-only migration, reversible
  transaction clearing status, optional expense-category monthly plans, and
  atomic account transfers with two-sided posting review, plus migration 0013's
  optional single account-backed emergency-fund checkpoint and migration 0014's
  singleton ledger currency with database-enforced change locks.
- Account/category create, rename, disable/re-enable/reorder, transaction,
  summary, recurring-rule, and emergency-fund checkpoint APIs.
- Responsive dashboard, conflict-safe transaction create/edit/delete,
  selected-month, fixed-range, or all-history account/category/payee/type/clearing/search filters,
  conflict-safe bulk clearing and same-type recategorization,
  deterministic date/amount/payee ordering, warning-only exact duplicate preflight,
  matching filtered transaction
  aggregate and ordered CSV export, with monthly and filtered money totals failing
  closed instead of publishing rounded values outside exact safe-integer precision,
  browser-local saved review views,
  ranked category-or-payee spending drilldown, monthly plan-versus-actual review,
  recorded-balance emergency-fund progress,
  deterministic preview-first HushLedger and
  generic bank CSV import, private payee memory,
  recurring-rule management, language settings, and the pristine-ledger currency
  setting.
- Versioned schema-14 currency-plus-seven-collection JSON backup with schema-8
  through schema-13 compatibility, SHA-256 integrity checking, preview-only
  restore reports, stale-preview protection, and transactional replacement.
- OpenAI-compatible model discovery and bank-text draft parsing with browser-tab
  provider settings, strict reviewable output, live duplicate preview, and only
  user-confirmed atomic D1 writes.
- Daily 00:05 HKT Cron plus manual due generation.
- Unit tests, typecheck, two linters, Next/OpenNext production builds, workerd
  preview, fresh migration, and upgrade migration validation.
- Public setup, security, contribution, issue, and pull-request documentation.

### Implemented: deeper organization

Accounts and categories can be moved with keyboard- and touch-friendly arrow
controls. Ordering persists in D1 without a drag-and-drop dependency and remains
isolated by active state plus category type.

### Implemented: user-configured AI bank-text parser

The app accepts an OpenAI-compatible base URL, API key, and model held only in
the current browser tab and sent to the Worker for each parse request. A user may
paste online-banking text, inspect and edit parsed drafts, then explicitly confirm
them. New rows are selected by default, possible duplicates require an explicit
choice, and stable source tombstones prevent silent re-import after deletion. AI
never writes directly to D1 and never supplies authoritative integer amounts or
database IDs. See
[AI_BANK_IMPORT_PLAN.md](AI_BANK_IMPORT_PLAN.md).

### Later reliability work

- IndexedDB outbox and explicit sync/conflict policy.
- Automated encrypted external backups.
- Browser-level end-to-end test suite in CI.

## Core release definition of done

- Clean checkout supports `npm ci` and local D1 migrations.
- Local Next.js development and the OpenNext workerd preview read and write D1.
- A transaction can be created, edited, cleared/uncleared, and deleted; each
  change appears in its list and monthly summary, and stale mutations are rejected.
- An account transfer can be created, edited, posted on each side, and deleted
  without changing recorded income, expense, or balance.
- Daily, weekly, and monthly rules can be created, edited, paused, resumed,
  skipped once, run, and deleted without duplicate occurrences or history loss.
- Date-only behavior is visible across UI, API, tests, and migrations.
- `npm test`, typecheck, ESLint, Oxlint, production build, fresh migrations, and
  upgrade migrations succeed.
- Cloudflare setup and Access boundary are documented without including secrets.
- No production deployment is claimed without actual command output.
