# Deploy HushLedger on Cloudflare

This guide creates a private HushLedger deployment with Cloudflare Workers,
D1, Cron Triggers, and Cloudflare Access. The repository never needs your
Cloudflare API token or Access credentials.

Official references:

- [Wrangler](https://developers.cloudflare.com/workers/wrangler/)
- [Create and bind a D1 database](https://developers.cloudflare.com/d1/get-started/)
- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Disable `workers.dev`](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)
- [Disable Preview URLs](https://developers.cloudflare.com/workers/versions-and-deployments/preview-urls/)
- [Cloudflare Access applications](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/choose-application-type/)

## 1. Prepare the repository

Install Node.js 22 or newer, clone the repository, and install the locked
dependencies:

```bash
git clone https://github.com/Coke1120/HushLedger.git
cd HushLedger
npm ci
npm run db:local
npm run verify
```

The local migration command uses Wrangler's local D1 state. It does not modify
your Cloudflare account.

## 2. Sign in and create D1

Authenticate in your browser, then create a database:

```bash
npx wrangler login
npx wrangler whoami
npx wrangler d1 create hushledger
```

Wrangler prints a `database_id`. Replace only the placeholder value in
`wrangler.jsonc`:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "hushledger",
    "database_id": "YOUR_D1_DATABASE_ID",
    "migrations_dir": "migrations"
  }
]
```

The binding must stay named `DB`, and the database ID is deployment metadata,
not a password. Do not paste tokens or secrets into this file.

## 3. Apply remote migrations

For a new empty database, inspect the pending list and apply all migrations:

```bash
npx wrangler d1 migrations list hushledger --remote
npx wrangler d1 migrations apply hushledger --remote
```

For an existing database, export a backup first and read every new migration.
D1 records applied migrations, so always add a new numbered migration instead
of editing a migration that production has already applied.

## 4. Create the Worker without a public route

The checked-in configuration explicitly sets both `workers_dev` and
`preview_urls` to `false` and does not contain a route. Run the quality gate,
then create/update the Worker script in this intentionally unreachable state:

```bash
npm run verify
npx wrangler deploy
```

Wrangler uploads the static app and API, but this configuration must not create
a `workers.dev`, preview, custom-domain, or route entry point. In **Workers &
Pages > HushLedger > Settings > Domains & Routes**, verify `workers.dev` and
Preview URLs are disabled and no route is attached. Stop if any public hostname
exists.

The checked-in Cron expression is:

```text
5 16 * * *
```

Cloudflare Cron uses UTC. This runs daily at 16:05 UTC, which is 00:05 in Hong
Kong on the following calendar day. The Worker derives the Hong Kong date and
generates due daily, weekly, or monthly transactions idempotently. Cron changes
can take several minutes to propagate.

## 5. Configure Access before attaching the hostname

HushLedger intentionally has no application-level login. Do not enter real
financial data until Access protects every production entry point.

1. Choose the exact future hostname, but do not attach it to the Worker yet.
2. In Zero Trust, open **Access > Applications**, add a **Self-hosted**
   application for that exact HushLedger hostname.
3. Add an **Allow** policy limited to your intended identity, such as one exact
   email address or a tightly scoped identity-provider group.
4. Keep the default-deny behavior for everyone else and require your identity
   provider's strong authentication or MFA.
5. Make sure the application covers both `/` and `/api/*`. A path-specific
   policy must not leave another path public.
6. Reconfirm the checked-in `workers_dev: false` and `preview_urls: false` values.
7. Only after the Access application and policy exist, attach the custom domain
   or route to the Worker. Do not enable either alternate URL.

This order prevents a public interval between deploy and Access setup. A
protected custom domain does not automatically protect alternate hostnames.

Verify with two browser sessions:

- A private/incognito session that is not signed in must be stopped by Access
  before HushLedger HTML or `/api/health` is returned.
- An allowed session must load the dashboard, create a test transaction, create
  and run a recurring rule, and refresh without errors.

Delete the fictional test data before entering real records.

## 6. Verify D1 and recurring generation

Check migration state and recent Worker logs:

```bash
npx wrangler d1 migrations list hushledger --remote
npx wrangler tail
```

Use the **產生到期交易** button for an authenticated manual check. Running it
twice must not create duplicate transactions for the same rule and date. The
Cron path and manual path use the same generation function.

Do not log request bodies, transaction notes, payees, full amounts, or bank
records while diagnosing a production issue.

## 7. Back up and test recovery

Create an encrypted, off-platform backup before migrations and on a regular
schedule:

```bash
mkdir -p backups
npx wrangler d1 export hushledger --remote --output="backups/hushledger-$(date +%Y%m%d-%H%M%S).sql"
```

The `backups/` directory is ignored by Git, but that is not encryption. Encrypt
the export and copy it to storage outside Cloudflare. Periodically restore into
a separate test database and compare table counts, monthly summaries, and a
small sample of fictional or redacted records. Never test a restore by
overwriting the only production database.

## 8. Configure future AI import safely

AI bank-record import is planned but not enabled in the current core release.
When that phase is implemented, provider credentials must be Worker secrets:

```bash
npx wrangler secret put AI_API_KEY
npx wrangler secret put AI_API_BASE_URL
```

Never place an AI API key in React code, Vite variables, a GitHub issue, build
logs, or `wrangler.jsonc`. See [AI_BANK_IMPORT_PLAN.md](../AI_BANK_IMPORT_PLAN.md)
for the review-before-write security boundary.

## Deployment checklist

- [ ] `npm run verify` succeeds from a clean checkout.
- [ ] Remote D1 migrations are applied to the intended database.
- [ ] `database_id` contains no token or secret.
- [ ] Initial deploy has no `workers.dev`, preview, custom-domain, or route URL.
- [ ] Access policy exists before the custom hostname is attached.
- [ ] The custom hostname, `/api/*`, and every alternate hostname are private.
- [ ] An unauthorized session is blocked by Access.
- [ ] An authorized end-to-end transaction and recurring-rule flow succeeds.
- [ ] The same due-run does not duplicate a recurring occurrence.
- [ ] An encrypted off-platform backup and restore drill exist.
- [ ] Real financial data and secrets are absent from Git, logs, screenshots,
      issues, and pull requests.
