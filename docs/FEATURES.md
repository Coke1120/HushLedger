# HushLedger feature reference

Detailed behavior and limits for the implemented features. Start with the
[README](../README.md) for setup and your first session.

## Features

- Monthly income, expenses, balance, a privacy-aware recorded savings rate when
  income is available, and recent transactions.
- A centered mobile quick-add action opens the same short transaction form as
  the desktop header without introducing a separate entry path.
- A zero-filled six-month recorded cash-flow trend comparing income, expenses,
  and net movement without treating transfers, opening balances, or forecasts as cash flow,
  with exact, neutral selected-month differences from the previous calendar
  month, private-screen masking, and one-tap navigation to any month in the chart.
- A ranked monthly income-source breakdown by category, with exact totals,
  transaction counts, shares of recorded income, and one-tap drilldown into the
  matching income records. Five sources stay visible by default, while an
  explicit action reveals every source, including inactive historical categories.
  Transfers, opening balances, and recurring forecasts never become recorded
  income, and privacy mode masks amounts, shares, and relative bar lengths.
- A ranked monthly expense breakdown switchable between categories and named
  payees, with exact totals, transaction counts, and one-tap drilldown into
  matching ledger records. Category rows compare each recorded total with the
  same category in the previous calendar month using neutral absolute differences;
  an in-progress selected month may be incomplete. Five rows stay visible by
  default, while an explicit action reveals the complete private aggregate.
  Payee drilldown uses a trimmed, case-insensitive exact match rather than broad
  text search.
- Optional monthly plans on expense categories, with planned, recorded, and
  remaining-or-over amounts shown together. A complete roll-up separates total
  planned spending, recorded spending in planned categories, the net plan
  difference, and spending outside every plan. Five rows stay visible by default,
  while an explicit action reveals every plan. Plans are recurring comparison
  guardrails only: they do not reserve cash, roll balances forward, or move money.
- A rolling 35-Hong-Kong-calendar-day outlook of active recurring entries that
  have not yet been generated, independent of the selected report month. It shows
  the absolute inclusive display dates, exact rule dates and amounts, and five
  consecutive 7-day periods for scheduled income, expenses, and net totals. A
  separate expandable list shows every ungenerated scheduled transfer with its
  exact ledger date, amount, and source-to-destination account direction; transfers
  never enter those totals. These local rule values are not bank confirmation,
  actual transactions, available balance or runway, or guaranteed dates or amounts.
- Amounts stored in each account's native currency as integer minor units to
  avoid floating-point errors.
- Per-account recorded, cleared, and uncleared balances at the end of the selected
  month, plus the exact number of still-uncleared entries through that cutoff so
  offsetting movements cannot hide review work. An optional dated opening balance
  anchors incomplete history. The in-app month-end reconciliation workspace
  compares the statement with the exact cleared balance. It keeps the statement
  value only on screen and never claims to lock the ledger. Its normal register
  remains range-bound and capped for responsive browsing; when that view cannot
  prove completeness, an explicit private action can load every uncleared entry
  through the statement close, including older out-of-period rows, with direct
  posting-status controls and exact full-history running balances. The same account
  register merges ordinary transactions with both transfer legs. Its separate CSV
  export downloads the complete selected account and range, including clearing
  state and running balances, without the 200-row screen limit.
- One optional emergency-fund checkpoint compares a user-chosen positive target
  with the recorded month-end balance of one active cash, bank, or wallet
  account. It does not create a separate balance, reserve or move money, recommend
  an amount or deadline, forecast future funds, or verify availability with a
  provider.
- A six-month recorded net-worth trend across every active and inactive account,
  including negative debts. Months with unknown pre-opening history are marked
  unavailable instead of silently omitting an account, and selecting a month
  opens that month throughout the overview.
- Record money moved between two accounts as one atomic transfer with independent
  source and destination posting states. Transfers stay outside income, expense,
  balance, category, plan, trend, and CSV transaction reports, so withdrawals and
  credit-card payments do not manufacture spending or income.
- Schedule a fixed same-currency transfer between two owned accounts with a daily,
  weekly, monthly, or yearly cadence and an optional inclusive end date. Each due
  occurrence inside the displayed 35-day window is visible until it becomes one
  native transfer with both sides uncleared for review. Earlier ungenerated dates
  remain part of the rule's due-generation workflow rather than this forward-looking
  window. This is ledger automation only: HushLedger never contacts a bank, moves
  real funds, or claims sufficient balance.
- Calculate a transaction amount with `+`, `-`, `*`, `/`, or parentheses. A
  bounded no-eval parser rounds only the final result before storing exact minor
  units, with touch-friendly operator buttons for mobile entry.
- Save and close the transaction dialog from any field with `Ctrl+Enter` or
  `Command+Enter`. The existing Save button advertises the shortcut visually and
  to assistive technology; HushLedger does not capture global single-letter keys.
- Closing or reloading a changed transaction, account transfer, or recurring rule
  requires explicit discard confirmation. Draft values remain only in the open
  dialog; HushLedger does not persist them to browser storage. If the ledger
  changes in another tab, the preserved draft keeps its opening currency and
  cannot be saved until the form is reopened against the new ledger state.
- Stack search, exact amount, income/expense, cleared/uncleared, the three-state
  import checklist, account, category, and exact possible-duplicate filters
  across matching transactions. The first 200 rows in the selected order load
  privately, and an explicit control loads the next 200 without putting filters
  or cursor data in the URL or browser storage. An invalid amount draft never
  removes an already-applied exact filter or broadens the result.
  Review the selected month, the seven Hong Kong calendar dates ending when the
  page loaded, one-click 12 complete calendar months through the selected month,
  an inclusive custom date range, or all history without changing the monthly
  overview, balances, transfers, plans, or forecasts. Both quick reviews become
  visible fixed inclusive ranges; the 12-month range becomes custom if later
  month navigation would otherwise move it. Inactive references remain available
  for historical review, and the loaded count is disclosed explicitly.
  Duplicate review is read-only and marks candidates instead of deleting either
  entry.
- Order a transaction review by newest or oldest date, largest or smallest
  amount, or payee name. The order is strictly validated and also applies to the
  complete CSV export; blank payees remain last.
- Review the exact match count, income, expense, and net amount for the current
  transaction filters. These totals cover every match, not only the rows currently
  loaded in the interactive list.
- Save up to eight named transaction views in the current browser and reapply
  their selected-month, fixed custom-range, or all-history scope plus type,
  clearing, import-checklist, account, category, exact payee, exact amount, search, tag,
  possible-duplicate, and ordering criteria. Selected-month views follow the
  month navigator; custom ranges keep their exact dates. Views contain review
  criteria only and do not sync to Cloudflare.
- Mark transactions as cleared when they appear at the bank. Manual, duplicated,
  and recurring entries begin uncleared for review; bank imports begin cleared,
  while HushLedger CSV and full-ledger backups preserve their recorded state. The
  account register can switch a transaction or the displayed side of a transfer
  directly, even when a complete uncleared review has loaded an older row whose
  full editor record is outside the current screen data. Loaded editor rows still
  open the full editor.
- Review every imported transaction with a reversible local checklist state:
  unreviewed, needs follow-up, or reviewed. New and upgraded imports start
  unreviewed. Transactions created manually or by recurrence have no state unless
  a later import links them. This checklist is separate from clearing and
  `#follow-up`, and does not detect or determine fraud, authorization, or bank
  confirmation.
- Explicitly select up to 200 visible ledger rows to mark them cleared or
  uncleared together, move a same-type selection to another active category, or
  change the import-checklist state when every selected row is imported.
  Each change is all-or-none: if any selected row has changed in another session,
  HushLedger leaves the complete selection untouched. Hidden matches are never
  included, mixed income/expense selections cannot be recategorized, and bulk
  delete is deliberately unavailable.
- Add case-sensitive, whitespace-delimited `#tags` to transaction notes. Tag
  chips apply an exact filter, stack with the other ledger filters, and carry
  through to the complete CSV export without adding a separate metadata store.
  The `#follow-up` shortcut retrieves items you marked for personal review; it
  does not classify fraud and remains independent of the structured import checklist.
- Export every transaction matching the current date scope and filters as an
  Excel-friendly UTF-8 CSV, without the 200-row display limit and with
  user-entered spreadsheet formulas neutralized. The checklist filter scopes the
  exported rows without adding a column or changing the ordinary CSV header.
- Export a separate, oldest-first account-register CSV for the selected inclusive
  date range. It includes an explicit available range-start balance, transactions,
  the selected account's signed transfer legs, clearing state, and exact running
  balances. It is a plaintext reconciliation report, not a transaction-import or
  full-ledger restore format.
- Re-import HushLedger CSV files directly, or map a bank CSV's delimiter, date,
  description, signed amount or debit/credit columns, destination account, and
  fallback categories in the browser. Bank imports can reuse the latest active
  category for an exact payee and income/expense match, then correct any row's
  category before a fresh duplicate check. New rows are selected automatically.
  Every committed import row enters the local checklist as unreviewed, including
  a uniquely matched uncleared transaction that receives an import source key.
  A cleared row that uniquely matches one otherwise identical
  uncleared ledger entry links its source and clears that entry instead of adding
  a duplicate; ambiguous matches stay unselected. Import tombstones stop the same
  source row from returning after deletion. Repeated imports can explicitly
  remember column, date, amount, and sign choices for the exact same headers in
  this browser without storing file contents, accounts, or categories.
- Download a versioned full-ledger JSON backup from Settings through an explicit
  same-origin action; direct `GET` navigation cannot start a plaintext download.
  Restore first shows a checksum-verified replacement report, then requires an
  explicit destructive confirmation before one transactional D1 replacement. A
  restore waits for in-flight ledger changes, then temporarily locks ledger
  controls, navigation, restarts, and leave-without-warning paths through refresh.
  A browser-local health record shows the last prepared backup download and integrity
  check. When that browser has no preparation record from the last 30 days, Overview
  links to the backup settings without claiming that an off-platform copy is missing
  or restorable.
- Edit or delete an existing transaction with conflict detection if another
  session changed it first.
- Before a manual create or edit, warn when the local ledger already contains an
  exact match on type, amount, currency, account, category, date, payee, and
  note. The check returns only a count, ignores clearing status, never calls AI,
  and can be overridden because identical real purchases are valid. The same
  predicate powers a review filter that can be stacked, saved, summarized, and
  exported without changing either candidate.
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
  Active recurring transaction rules protect their account and category, while
  active scheduled transfers protect both accounts. The last usable references
  are also protected from accidental disabling.
- Custom payees and notes, with private suggestions that can reuse a known
  payee's latest still-active account and category without sending ledger data
  to a third party.
- Daily, weekly, monthly, and yearly recurring transactions that can be created,
  edited, paused, resumed, skipped once without creating a transaction, and deleted.
  An optional inclusive end date automatically completes a rule after its final
  scheduled occurrence without deleting generated history.
- Daily, weekly, monthly, and yearly scheduled account transfers with distinct
  source/destination accounts, exact amount, note, start date, optional inclusive
  end date, pause/resume, one-occurrence skip, completion, and preserved generated
  history. Offline and demo views expose no live mutations and store no rule draft.
- Due-transaction generation through Cloudflare Cron or a manual action, with no
  duplicate occurrence for the same rule and date. A manual run reports blocked,
  failed, or safety-limited work as incomplete instead of presenting full success.
  Both recurring lists use the Hong Kong calendar date to put overdue and due-today
  active rules first, distinguish the next seven days, and leave paused or completed
  rules out of the due count. These labels describe ledger entries waiting to be
  generated; they do not assert that an external bill was paid or move real funds.
- A neutral amount review when the most recent remaining transaction generated by a
  recurring rule differs from that rule's amount for future entries. HushLedger shows
  the recorded due date and both locally stored amounts as informational context.
  A difference alone is not labelled an error, and HushLedger never infers a cause or
  changes either amount automatically.
- Stable end-of-month anchors: a January 31 rule runs on the last day of February
  and returns to March 31 instead of drifting.
- Stable leap-day anchors: a yearly February 29 rule runs on February's final day
  in non-leap years and returns to February 29 in the next leap year.
- A PWA app shell, mobile bottom sheets, and responsive tablet and desktop layouts.
- One silent data recheck when an already-loaded live ledger tab returns from hidden state.
  Successful responses replace stale money and both recurring-rule views; failed
  rechecks preserve the current view and never substitute demo data. HushLedger
  adds no polling timer or background-sync service for this check.
- A one-tap screen privacy mode that masks every formatted amount, category-share
  bar, editable amount field, pasted AI bank text, and raw mapped-CSV sample for
  safer screen sharing, and turns on automatically while the app is hidden or
  unfocused without changing the user's prior choice.
- Manual-by-default app updates with an opt-in automatic install-and-restart mode.
- Clear loading, demo, offline, success, and error states.
- A settings page for switching among Traditional Chinese, English,
  Japanese, and French, for choosing the default/reporting currency before monetary
  history exists, and for assigning a native currency to each account. Currency
  stays private in D1 and full-ledger backups. A user can explicitly fetch and
  retain ECB EUR-base reference-rate observations; HushLedger never fetches them
  in the background and does not convert ledger amounts.

HushLedger starts with cash, bank, credit-card, wallet, income, and expense
defaults. Settings can add custom accounts and categories, rename them, change a
custom or built-in account type, disable or re-enable entries, and persist a
preferred order without drag-and-drop. Disabled entries disappear from new
transaction choices but remain attached to history; the app intentionally offers
no destructive account/category delete action. See
[PROJECT_BRIEF.md](../PROJECT_BRIEF.md).

In HushLedger, a payment method is an account such as cash, a bank account, a
credit card, or a digital wallet. It is not an additional transaction type.
