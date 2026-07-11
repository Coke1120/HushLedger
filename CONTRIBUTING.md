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

Run the Worker and frontend in separate terminals:

```bash
npm run dev:worker
```

```bash
npm run dev
```

The Vite app is available at `http://localhost:5173`; `/api` requests are
proxied to the local Worker at `http://localhost:8787`.

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
