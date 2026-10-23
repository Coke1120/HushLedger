# Paste, review, approve — dev implementation

The development branch now opens on Transactions with one prominent **Paste
transactions** action. The approved text layout is implemented in the existing
Next.js/Cloudflare application and its existing green/white design system; no
whole-app rewrite or external design concept was introduced.

## Workflow

1. Select a financial account/currency, choose date order and paste text.
2. Analyze sends only that text and allowed category names to the configured AI
   provider. Historical ledger records never enter the parsing request.
3. Edit date, payee/description, direction, amount and category. Original text
   collapses after parsing. Source and suggestion explanations expand per row.
4. Approve a row, or explicitly select valid rows and approve the selected batch.
   Nothing is selected automatically. Uncertain dates/directions/amounts and
   reconciliation warnings need an explicit check; possible duplicates need a
   separate confirmation. A year-looking amount is not accepted as date evidence.
5. Undo an approval only while all its rows remain at the approved versions.

Transfers remain in the existing detailed bank reconciliation workflow, reachable
under More import tools. Pasted text/account are handed over without persistence.
CSV, manual entry, existing reviews, reports, recurring rules and settings remain
available. Advanced transaction tools are collapsed and unrelated controls are
hidden while paste review is open. Desktop uses horizontal editable rows; mobile
uses stacked cards with the same controls and no horizontal scrolling.

## Approval, history and safety

Migration `0022_paste_approvals.sql` adds:

- `transaction_approvals`: exact approved transaction version, with automatic
  invalidation on any update and cascade deletion. Only legacy `reviewed` imports
  are backfilled; saved manual/unreviewed rows are not silently approved.
- `paste_operations`: request ID, normalized-payload SHA256, state and timestamps.
- `paste_operation_items`: affected transaction IDs and their approved versions.

The explicit review API can reapprove a corrected imported transaction. It records
only the version actually reviewed; a racing later edit cannot become eligible.
Suggestion queries require an account and join current approval versions. Matching
uses normalized payee and direction, preferring a previously approved matching
amount and otherwise the latest reference. Historic amounts rank category
references only: they never replace the pasted amount. Manual entry and CSV also
use account-scoped approved suggestions. Inactive categories remain ineligible.

The new `/api/imports/approve` endpoint has separate preview, approve and undo
modes. Preview is read-only. Approval binds a ledger revision and writes the
receipt, all selected transactions, import tombstones and approval versions in one
D1 batch. A failed row rolls back the entire batch. Reusing an operation ID with
changed content is rejected; an unchanged retry returns the receipt, even after
undo. The UI retains the exact request when a network response is lost. Explicit
rejections permit editing and a fresh preview.

Duplicate checks deliberately ignore category/note differences and include
siblings in a batch. Existing import keys and deleted transaction IDs remain
protected by tombstones. Approvals create new rows only; the simple workflow does
not silently clear or overwrite an existing matching transaction. Undo affects
only rows created by its receipt, requires current version/approval matches, and
keeps the source tombstones. This is a receipt audit trail, not a second copy of
financial amounts or raw pasted text.

The deployment remains one private D1 ledger behind the existing Cloudflare
Access boundary. A financial account is not a separate authenticated tenant. No
new accounts, privileges, provider access, or multi-tenant claims were added.

## Restore behavior

Approval and retry/undo receipts are operational metadata, excluded from portable
ledger JSON backups (like provider settings). The exported financial schema is
unchanged. Restoring a ledger clears approval eligibility by deleting the old
transactions and invalidates outstanding undo receipts atomically with restore.
It does not trust restored `reviewed` labels as proof of a locally approved current
version. Imported records can be explicitly reviewed again. Existing receipts
continue to prevent retries from recreating old rows. D1 database backups include
these tables. No real database was migrated during this task.

## Verification and visual evidence

All tests use synthetic data. The focused server suite uses real SQLite with all
migrations and a transactional D1 adapter. It covers no-write previews, historical
eligibility, corrected/reapproved versions, account isolation, duplicate warnings,
retry/payload mismatch, preserved tombstones, atomic rollback, stale references,
upgrade backfill and guarded undo. Existing Worker integration also exercises the
new approval/history/retry/undo endpoint with temporary D1 databases.

Browser checks use Playwright and the environment's `/usr/bin/chromium`, because no
Browser/IAB connector was available. The optional Playwright browser download was
unavailable (CDN returned 403); the already-installed browser was used in this same
cloud environment. The browser's AI parse response/provider metadata are fixtures;
ledger writes, history, retries and undo run through the real local API. The
existing integration suite separately verifies parsing with a local fake provider.

The [desktop](desktop.png) and [mobile](mobile.png) captures were directly inspected
at 1440×1100 and 390×844 viewports. The [browser evidence](browser-evidence.json)
records approval, explicit duplicate acknowledgement, category correction, batch
selection, lost-response retry, account isolation and undo. The injected lost
response intentionally produces one browser network error; there were no page
runtime errors. The final retained screenshots use the packaged OpenNext Worker runtime, without development overlays.

Visual review checked the approved copy/actions, horizontal row and mobile-card
layout, existing palette, control typography, collapsed source/rationale, clear
warning states, focusable native inputs and mobile width. Early issues fixed:
source text consumed the review viewport, Reset used an unstyled button, mobile
paste action hid its label, and the close button shrank. Original text now folds,
secondary buttons use the existing palette, mobile shows the paste label, and the
close control stays 44px wide. The final renders follow the approved text layout;
no image-generated reference was needed for this scoped existing-app refactor.

To rerun the optional browser smoke, create a fresh **temporary local** database:

```sh
WRANGLER_SEND_METRICS=false XDG_CONFIG_HOME=/tmp/hushledger-config \
  node node_modules/wrangler/bin/wrangler.js d1 migrations apply hushledger \
  --local --persist-to /tmp/hushledger-ui-state
HUSHLEDGER_DEV_PERSIST_PATH=/tmp/hushledger-ui-state/v3 \
  NEXT_TELEMETRY_DISABLED=1 WRANGLER_SEND_METRICS=false \
  XDG_CONFIG_HOME=/tmp/hushledger-config npm run dev -- --port 3100
```

Use a new temporary state path if it contains anything except test fixtures. In
another shell install Playwright outside the repository and run the script:

```sh
npm install --prefix /tmp/hushledger-browser --cache=/tmp/hushledger-npm-cache playwright
HUSHLEDGER_PLAYWRIGHT_MODULE=/tmp/hushledger-browser/node_modules/playwright \
  node scripts/paste-review.browser.mjs
```

The script expects an empty ledger, inserts three fictional transactions, verifies
and undoes them, and leaves only synthetic import tombstones/receipts. It writes
screenshots and evidence under `/tmp`. Run it only against the isolated test server
on port 3100. It never calls a real AI provider.

Final gate: `npm run verify` passed on Linux x64, Node 24.19.0 / npm 11.9.0
with fixture umask 022: 678 application tests, six local-state checks, strict
TypeScript, Worker type generation check, ESLint/oxlint, Next/OpenNext production
build and the complete synthetic integration suite. Two macOS-only tests skipped.
The server wrapper additionally runs seven SQLite approval-contract cases. After
minor UI guard refinements, lint/typecheck, the production build, and the browser
suite against the packaged Worker were rerun successfully. Full and production
npm audits both report zero vulnerabilities. No dependencies changed in this
redesign; the previously verified clean dependency install is preserved.

Fresh and upgrade migrations through 0022 passed. The archive was verified against
all 379 tracked files of the exact main source commit, with matching SHA256.

Not run: macOS-specific checks, ARM64 container execution, Node 22 execution,
external-provider/model quality assessment, and hosted CI. These are environment
or external-service gaps; no real provider, credentials, production data, or live
financial records were used. The prior workerd pin remains unchanged. No deployment
or PR to main is part of this work. Main's preserved source archive and restoration
instructions are in [legacy](../../legacy/README.md).
