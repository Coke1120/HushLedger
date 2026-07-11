# HushLedger UI / UX QA

This report records release evidence for the date-only transaction workflow and
daily, weekly and monthly recurring automation. All screenshots use fictional local
D1 data and contain no private financial records.

## Final visual evidence

- `qa/desktop-1440-live.png` — live Worker/D1 dashboard at 1440 × 900.
- `qa/tablet-768-live.png` — live Worker/D1 dashboard at 768 × 1024.
- `qa/mobile-390-live.png` — live dashboard at 390 × 844.
- `qa/mobile-390-dialog.png` — transaction bottom sheet at 390 × 844.
- `qa/mobile-390-offline.png` — explicit offline/read-only state at 390 × 844.
- `qa/recurring-desktop-1440.png` — recurring rules at 1440 × 900.
- `qa/recurring-mobile-390.png` — recurring rules at 390 × 844.
- `qa/recurring-mobile-dialog-390.png` — recurring-rule form at 390 × 844.

Browser interactions and DOM assertions used the Codex in-app Browser. Its raster
capture timed out, so the final PNG evidence was captured from the same local route
through Chromium DevTools Protocol with exact device metrics.

## Responsive and accessibility evidence

- 320, 390, 768 and 1440 px: no horizontal document overflow.
- Visible mobile controls have a minimum 44 px hit target; desktop search is wrapped
  by a 44 px clickable label.
- Dates render as calendar dates only; no user-facing transaction time exists.
- Transaction and recurring-rule forms use labelled native inputs and selects.
- Dialogs use `role="dialog"`, accessible names, close controls and focus return.
- Transaction dialog opens on amount entry; Escape closes it and returns focus to
  the invoking action.
- Expense/income switching immediately limits categories to the matching type.
- Empty, validation, saving, success, demo and offline states were exercised.
- Offline copy explicitly says mutations will not be saved.

## Recurring automation workflow evidence

- Created a daily rule and generated the due transaction.
- Re-running the same due date created zero duplicates.
- Edited its name and amount without rewriting the already generated transaction.
- Paused and resumed the rule.
- Deleted the rule through a labelled confirmation dialog.
- Confirmed the generated transaction remained with its original rule-name snapshot.
- Confirmed the edit form keeps the monthly/weekly anchor separate from `next due`.

## Concept-to-implementation fidelity ledger

1. Preserved the warm-white canvas, forest-green identity and restrained
   income/expense colors from the visual direction.
2. Preserved the desktop hierarchy: compact brand header, month navigation, three
   summary cards, then transaction content with search and filters.
3. Preserved the mobile hierarchy: full-width balance, two-column income/expense,
   compact rows, three-tab bottom navigation and bottom-sheet forms.
4. Kept prominent HKD amount entry, expense/income switch, account/category pairing,
   date, payee, note and a full-width save action.
5. Removed row chevrons where there is no detail destination, avoiding a false
   affordance.
6. Used native select/date controls to preserve keyboard, screen-reader and mobile
   input behavior.
7. Replaced profile decoration with the primary add action because the product is
   single-user and quick entry is the main task.
8. Added recurring-rule provenance in generated transaction rows so automation is
   understandable without exposing internal IDs.

## Product contract checks

- HKD uses integer minor units end to end.
- User transaction dates are `YYYY-MM-DD`; audit timestamps remain internal.
- Automation supports create, edit, pause, resume and delete for daily, weekly and
  monthly rules.
- Monthly anchors remain stable across shorter months.
- Delete is non-destructive to generated transaction history.
- Offline mode is read-only and clearly labelled.
