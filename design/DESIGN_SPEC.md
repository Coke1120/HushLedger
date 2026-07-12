# HushLedger UI design specification

The accepted visual references are:

- `dashboard-desktop-concept.png` at 1487 x 1058.
- `transaction-mobile-concept.png` at 853 x 1844.

They define the layout, density, palette, typography character, control geometry,
and responsive behavior. All product text and controls remain code-native. Where
generated text differs from the product brief or locale dictionaries, the brief
and current translations are authoritative.

## Direction

Calm, personal, and trustworthy rather than enterprise-like. The desktop uses a
simple top bar, compact month navigation, a three-part summary band, and one
full-width transaction surface. The mobile layout puts the balance first,
places income and expense side by side, keeps transaction dates visible, and
uses a rounded bottom sheet for quick entry.

No sidebar, charts, gradients, marketing hero, decorative eyebrow text, badges,
decorative illustration, nested card grid, or remote font request.

## Tokens

| Token | Value |
| --- | --- |
| Background | `#f4f6f2` |
| Surface | `#ffffff` |
| Ink | `#18312c` |
| Brand | `#17483c` |
| Muted | `#64766f` |
| Border | `#dde5e0` |
| Income | `#147a5a` |
| Expense | `#b14b46` |
| Focus | `#2f7e70` |
| Spacing | `4 / 8 / 12 / 16 / 24 / 32 / 48px` |
| Radius | `10 / 14 / 18px` |
| Minimum target | `44px` |

Typography uses a local system font stack with coverage for Traditional Chinese,
English, Japanese, and French, plus tabular numerals for money. Controls define
their own size and weight instead of using browser defaults.

## Component inventory

- `AppHeader`: wallet mark, HushLedger, localized product descriptor, primary
  navigation, and localized add-transaction action.
- `MonthNavigator`: previous, localized month label, next, and return-to-current-month.
- `SummaryCards`: balance, income, and expense with one prominent balance card.
- `ConnectionBanner`: loading, offline, demo, error, and retry states.
- `TransactionToolbar`: search and 全部 / 支出 / 收入 filters.
- `TransactionList`: merchant or category, category/account metadata, visible
  calendar date, and signed HKD amount.
- `TransactionDialog`: expense/income segmented control, amount, account,
  filtered category, date, payee, note, validation, and sticky save action. There
  is no transaction time field.
- `RecurringRulesPage`: daily, weekly, and monthly rules with next date, account,
  category, generated count, edit, pause/resume, and protected deletion.
- `RecurringRuleDialog`: date-only schedule anchor, monthly short-month guidance,
  active state, validation, and future-only edit explanation.
- `SettingsPage`: one clear language selector for Traditional Chinese, English,
  Japanese, and French, with immediate feedback and local-only persistence note.
- `MobileNavigation`: overview, transactions, recurring rules, and settings; all
  labels are localized and every control changes the visible view.

## Allowed first-viewport copy

`HushLedger`, the localized product descriptor, selected localized month,
return-to-current-month action, add-transaction action, balance, income, expense,
transaction list, search, filters, and current-month summary. Status copy may
appear only when its state is active. The same information hierarchy applies to
all supported languages; no locale receives extra first-viewport marketing copy.

## Responsive contract

- Desktop at 1024px and above: content width up to 1120px; three summary cards;
  table-like transaction rows.
- Tablet from 768px: three summary cards with reduced padding; complete dates
  and amounts remain visible.
- Mobile below 768px: 16px gutters plus safe areas; balance spans full width;
  income and expense share one row; transaction rows become compact cards;
  the form is a bottom sheet with a sticky action.
- Verified target widths: 320, 390, 768, 1024, and 1440px.

## Required states

Loading, saving, success, empty, API error, offline, and demo. Demo mode must say
that entries stay only on this device session and are not saved to Cloudflare.
The app is online-first and must never claim an offline write succeeded.

## Accessibility contract

Semantic headings and lists/tables, 44px interactive targets, visible
`:focus-visible`, sufficient contrast, `aria-live` status, field-linked errors,
language changes announced without moving focus, and a labelled modal dialog
that supports Escape, initial focus, focus restore, and scroll locking.
