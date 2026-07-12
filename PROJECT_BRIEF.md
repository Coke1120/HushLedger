# HushLedger product brief

> Updated: 2026-07-12 (HKT)
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

- View HKD income, expense, and balance for a selected month.
- Browse the latest 200 transactions for a selected month; the UI explicitly
  discloses the cap when it is reached.
- Search payee, note, account, or category.
- Filter income and expense.
- Switch the interface language in Settings; keep the preference in the current
  browser only.

### Record money

- Add income or expense in a short responsive form.
- Choose an active account and a matching income or expense category.
- Add a custom payee or note.
- Select a calendar date only; no transaction-time field exists.
- Receive explicit success, error, demo, and offline feedback.

### Automate predictable entries

- Create a daily, weekly, or monthly recurring rule.
- Set name, type, amount, account, category, schedule date, payee, note, and
  active state.
- Modify, pause, resume, or delete the rule.
- Generate due transactions from Cloudflare Cron or the authenticated manual
  action.
- Preserve generated history when a rule changes or is deleted.

## Data contract

### Transactions

```text
id                    client-generated UUID
type                  income | expense
amount_minor          positive integer minor units
currency              HKD in the current release
account_id            active compatible account
category_id           active matching category
occurred_on           YYYY-MM-DD calendar date
payee                 optional custom text
note                  optional custom text
recurring_rule_id     nullable provenance
recurring_rule_name   nullable immutable name snapshot
recurrence_due_on     nullable immutable scheduled date
created_at            internal UTC audit timestamp
updated_at            internal UTC audit timestamp
```

HK$123.45 is stored as `12345`. Binary floating point is never authoritative.
`occurred_on` is intentionally date-only; audit timestamps must not be presented
as transaction time.

### Accounts and categories

The current seed supports cash, bank, credit card, wallet, income categories,
and expense categories. References use foreign keys and `is_active` so history
survives future soft-disable operations.

The next master-data phase adds create, rename, reorder, and disable UI/API for
custom bank, cash, payment, wallet, credit-card, income, and expense entries.
Hard deletion of referenced master data is not allowed.

In product wording, a custom `payment` item means a payment-method account such
as cash, bank, credit card, or wallet. It is not a separate transaction or
account type in the current data model.

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
GET    /api/accounts
GET    /api/categories
GET    /api/transactions?month=YYYY-MM&type=...&search=...  (latest 200)
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

Responses use one success/error envelope. API input is strict Zod-validated;
the server independently validates amount, currency, account state, category
state, category type, content type, body size, and same-origin mutation.
Database and stack errors are never returned to the client.

## Reliability and privacy

- Cloudflare Access protects every production UI and API hostname, and the custom
  Worker cryptographically verifies its signed JWT before forwarding to Next.js.
- The Cloudflare account uses strong authentication and MFA.
- Repository, logs, fixtures, screenshots, issues, and pull requests contain no
  secrets or real financial data.
- `.wrangler/`, local databases, exports, and backups are ignored by Git.
- D1 is not the only copy: maintain encrypted off-platform backups and periodic
  restore drills.
- Only the non-sensitive offline/demo shell and fingerprinted static assets may be
  cached. API, Server Action, RSC, personalized navigation, and financial responses
  are never cached. Offline writes and multi-device conflict sync are not claimed.

## UX direction

- Calm warm-white canvas, forest-green identity, restrained income and expense
  colors, and a system font stack that supports all four product languages.
- Phone-first quick entry with a bottom sheet; useful tablet and desktop width.
- A Settings page with immediate language switching and local-only preference
  persistence.
- Semantic HTML, visible focus, keyboard navigation, focus restore, 44 px touch
  targets, sufficient contrast, and field-linked errors.
- No fake navigation, decorative charts, remote fonts, marketing hero, or
  hidden failure state.

## Delivery status

### Complete core

- D1 schema, seed, constraints, indexes, and date-only migration.
- Accounts, categories, transactions, summary, and recurring-rule APIs.
- Responsive dashboard, transaction form/list, recurring-rule management, and
  language settings.
- Daily 00:05 HKT Cron plus manual due generation.
- Unit tests, typecheck, two linters, Next/OpenNext production builds, workerd
  preview, fresh migration, and upgrade migration validation.
- Public setup, security, contribution, issue, and pull-request documentation.

### Next: custom master data and deterministic import

1. Create/edit/disable/reorder accounts and categories.
2. Add import batches, review state, duplicate fingerprints, and atomic commit
   without AI.
3. Add CSV and JSON import/export.

### Then: user-configured AI bank-text parser

Support an OpenAI-compatible base URL, API key, and model configured only on the
Worker. A user may paste online-banking text, inspect and edit parsed drafts,
then explicitly confirm an import. AI never writes directly to D1 and never
supplies authoritative integer amounts or database IDs. See
[AI_BANK_IMPORT_PLAN.md](AI_BANK_IMPORT_PLAN.md).

### Later reliability work

- IndexedDB outbox and explicit sync/conflict policy.
- Automated encrypted external backups.
- Restore verification automation.
- Browser-level end-to-end test suite in CI.

## Core release definition of done

- Clean checkout supports `npm ci` and local D1 migrations.
- Local Next.js development and the OpenNext workerd preview read and write D1.
- A transaction appears in its list and monthly summary.
- Daily, weekly, and monthly rules can be created, edited, paused, resumed, run,
  and deleted without duplicate occurrences or history loss.
- Date-only behavior is visible across UI, API, tests, and migrations.
- `npm test`, typecheck, ESLint, Oxlint, production build, fresh migrations, and
  upgrade migrations succeed.
- Cloudflare setup and Access boundary are documented without including secrets.
- No production deployment is claimed without actual command output.
