# Contributing to HushLedger

Thank you for helping make HushLedger safer and easier to use. Bug reports,
documentation improvements, tests, accessibility fixes, and focused feature
proposals are welcome.

## Before opening an issue

- Search existing issues to avoid duplicates.
- Do not attach real bank statements, account numbers, API keys, or personal
  transaction data.
- For security issues, follow [SECURITY.md](SECURITY.md) instead of opening a
  public issue.
- Keep feature proposals aligned with a private, single-user, online-first
  finance tracker.

## Local setup

Requirements: Node.js 22 or newer and npm 10 or newer.

```bash
git clone https://github.com/Coke1120/HushLedger.git
cd HushLedger
npm ci
npm run db:local
```

Start Next.js with the local Cloudflare binding bridge:

```bash
npm run dev
```

The application is available at `http://localhost:3000`. Use `npm run preview`
when a change needs validation in the production-like OpenNext workerd runtime.

## Pull requests

1. Create a focused branch from `main`.
2. Add or update tests for changed behavior.
3. Keep finance values in integer minor units and transaction dates as
   `YYYY-MM-DD`; do not introduce a transaction-time field.
4. Never commit secrets, `.wrangler/`, local databases, exports, backups, or
   real financial data.
5. Run the complete quality gate:

   ```bash
   npm run db:local
   npm run verify
   npm audit --omit=dev --audit-level=high
   ```

6. Explain the user-visible result, tests, migration impact, and any known
   limitations in the pull request description.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Translations

HushLedger supports Traditional Chinese (`zh-Hant`), English (`en`), Japanese
(`ja`), and French (`fr`). User-facing copy belongs in
`src/i18n/messages.ts`; avoid adding hard-coded interface text to components.

When changing translated copy:

- Update every locale for each new or changed message key.
- Preserve interpolation placeholders and their meaning across all languages.
- Keep finance terminology short, unambiguous, and consistent within a locale.
- Do not translate custom user data such as account, category, payee, note, or
  recurring-rule names.
- Verify long English and French labels at the supported responsive widths, as
  well as keyboard navigation, focus visibility, and screen-reader labels.
- Include screenshots only with fictional or thoroughly anonymized data.

Translation corrections and accessibility improvements are welcome as focused
issues or pull requests, including changes from fluent speakers who are not
developers.
