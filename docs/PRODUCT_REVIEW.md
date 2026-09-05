# Product and delivery review

Reviewed on 2026-09-06 (HKT) against the local beta checkout. This is a product
and delivery assessment based on source, documentation, and the validation below;
it is not user research or a production deployment audit.

## Decision

Keep HushLedger focused on a private personal ledger for one person. Its strength
is dependable entry, review, import, recurring records, and recovery. The next
milestone should make these workflows easier to start, finish, and verify.
Additional reports, integrations, and offline synchronization should compete for
priority only after the core journeys meet the acceptance criteria below.

The technical foundation is substantial: exact minor-unit money, guarded writes,
preview-first imports and restore, data-preserving account lifecycle, and isolated
Worker integration checks. The product's main weakness is discoverability and
completion of those capabilities. There is no usage evidence in this review to
justify claims about adoption, retention, or willingness to pay.

## Findings and changes

| Priority | Evidence and user impact | Decision |
| --- | --- | --- |
| P1 | The README placed hundreds of lines of feature detail before setup. A new user had to navigate an implementation catalogue to start a private ledger. | Put local use, sample demo, and private deployment near the top; add a first-session checklist and a separate feature reference. |
| P1 | `AppHeader` disabled AI import before provider configuration, although `BankImportPanel` already offers a Configure action. | Let the header reach the existing setup prompt; retain unavailable/offline guards. |
| P1 | `CsvImportPanel` completed imports without a way to remove the previous month and filters. Historical imports could succeed while their records remained hidden. | Offer the existing all-history unreviewed-import action after rows are imported or matched. It includes all unreviewed imports, not just the latest file. |
| P1 | The product brief and recovery guide retained older currency, backup, and AI persistence claims. | Align the descriptions with native account currencies, schema-20 backup, and optional encrypted provider settings. |
| P1 | Browser E2E coverage was grouped with speculative offline synchronization as later work. Passing API checks alone cannot prove a usable browser journey. | Make core browser journeys a release priority and keep offline writes deferred. |
| P2 | `TransactionList` uses filter-oriented empty copy for a new ledger; navigating away from import panels discards their in-memory drafts. | Schedule contextual first-use guidance and import draft/discard protection as the next UX work. Do not infer an empty ledger solely from an empty filtered month. |

## Delivery plan

Owners below are responsibility roles for the maintainer to assign; dates should
be committed only after the work is sized. The criteria are proposed release
gates, not claims that user validation or CI browser coverage already exists.

| Order | Deliverable | Owner | Acceptance evidence |
| --- | --- | --- | --- |
| Now | First-use guidance and import completion | Product + frontend | A new user follows the README, chooses currency before history, configures an account, saves a fictional transaction, reloads, and finds the same amount and monthly effect without undocumented help. Historical CSV completion opens all-history unreviewed imports with prior filters cleared. |
| Next | Core browser regression suite in CI | Frontend + QA | Create/edit/reload, historical CSV import/review, recurrence generation, and backup preview/restore run against isolated fictional data. Check keyboard focus, offline refusal, stale-write feedback, and narrow-screen layout. Cover representative journeys in every locale. |
| Next | Draft preservation and contextual empty states | Frontend | Leaving an edited import requires explicit discard or preserves the draft in memory. An empty fresh ledger offers setup/entry guidance; a filtered empty result retains filter guidance. Neither path persists statement contents to browser storage. |
| Next | Repeatable upgrade and recovery drill | Maintainer | On an isolated ledger, follow published instructions through upgrade, export, restore, and restart; compare exact counts and amounts. Record runtime, revision, expected/actual results, and recovery steps. For deployment, separately verify authenticated access and rejection on alternate routes. |
| Later | Automated encrypted backups | Maintainer | Define who owns keys, retention, off-platform storage, failure notification, and recovery when the primary deployment or key is lost; demonstrate a restore before calling the feature complete. |
| Deferred | Offline writes and broader integrations | Product | Document a recurring user problem and expected benefit before design. Offline writes require an agreed conflict policy and recovery story before an outbox is implemented. |

## Product success checks

Use opt-in walkthroughs and fictional data; the review introduces no telemetry.
Ask three prospective users to complete a first session and a historical import.
Record task completion, where help was needed, and elapsed time without capturing
financial contents. Treat three unassisted completions as an initial usability
gate, not statistically representative research. Set a time target after this
baseline rather than claiming an unmeasured improvement.

For ongoing use, ask whether the person can find an imported transaction, explain
recorded versus cleared balances, and locate a recoverable backup. Prioritize the
repeated failures before requesting more features. A downloaded backup reminder
does not establish that a file was retained or that disaster recovery works.

## Validation of this change

The initial review validated changes on top of `af53659` using Node.js 25.8.1 and npm 11.13.0 on
macOS. CI's Node.js 22 environment was not run locally.

- `npm run verify` passed after the final code and spacing changes: 672
  TypeScript tests plus 8 local-state tests, typecheck, generated Worker types,
  ESLint, Oxlint, Next.js and OpenNext builds, and the isolated Worker integration
  gate. The gate exercised fresh migrations `0001–0021` and preserved-data upgrades
  from `0004` through `0021`, including import, recurrence, and backup/restore checks.
- `npm audit --omit=dev --audit-level=high` reported zero vulnerabilities.
- The changed components' focused suite passed 18 tests. New coverage checks
  unconfigured header access, unavailable-entry locks, successful/matched CSV
  completion, skipped-only results, and unavailable completion controls.
- Chromium against the built OpenNext Worker and a separate fictional D1 ledger
  confirmed header-to-AI-setup navigation, keyboard access to Connections, CSV
  amount validation, historical CSV commit, and the new completion action.
  With an unrelated search, an income-only filter, and September 2026 selected,
  review cleared the search/type constraints, selected all history and unreviewed
  imports, focused the results, and displayed the March 2025 expense. Reload and
  month selection retained its exact HK$12.34 expense and summary effect.
- The final English completion layout was visually checked at 390 × 844. The
  page stayed within 390 pixels, the button was 44 pixels high, and an 8-pixel gap
  separated it from the wrapped success message. Desktop entry navigation was
  also exercised. No browser console errors were reported during the core flow.
- All 33 local Markdown file/anchor links in the changed documentation resolved;
  `git diff --check` passed. Existing unrelated ignore-file and lint-config edits
  were preserved.

Local logs and fictional-data screenshots are retained under the ignored
`output/playwright/pm-review/` directory. These browser checks covered English;
the completion action reuses existing translations in all four locales, but
four-locale browser validation remains a release gate.

Publication validation included the newer `e6fdff5` maintenance commit, retaining
its explicit read-only demo and lazy locale loading. The combined changes passed
`npm run verify`: 673 TypeScript tests plus 8 local-state tests, type and lint
checks, the OpenNext production build, and the full Worker integration gate.
All 34 local documentation links resolved. The browser evidence above records
the initial review; it was not repeated after this integration.

Production Access, a real deployment, scheduled production execution, device PWA
installation, a production recovery drill, and independent user walkthroughs are
outside this local review. The browser checks performed here do not replace the
planned persistent CI browser suite.
