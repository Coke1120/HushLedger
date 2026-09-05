# Deploy HushLedger on Cloudflare

This guide creates a private HushLedger deployment with Cloudflare Workers,
D1, Cron Triggers, and Cloudflare Access. The repository never stores your
Cloudflare API token or user sign-in credentials.

If you are new to terminals or Cloudflare, use the
[beginner-friendly deployment guide](EASY_DEPLOY.md) first. This page is the
advanced reference for verification, backups, recovery, and AI privacy boundaries.

## Local use or private deployment

Cloudflare deployment is optional. For use on one computer, follow the
[README local setup](../README.md#local-development) and run `npm run dev`. Local
mode uses a local D1 database and requires no Cloudflare account, domain, Access
configuration, or HushLedger API key. An AI provider key is needed only when the
optional AI draft feature is used.

Deploy when you need HushLedger from other devices or outside that computer. The
custom domain is internet-reachable, but Cloudflare Access must keep the
application private. HushLedger does not define `npm run start`: a plain Next.js
server would not provide the required D1 binding. Use `npm run preview` for a
production-style Worker running locally.

Official references:

- [Wrangler](https://developers.cloudflare.com/workers/wrangler/)
- [Create and bind a D1 database](https://developers.cloudflare.com/d1/get-started/)
- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Disable `workers.dev`](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)
- [Disable Preview URLs](https://developers.cloudflare.com/workers/versions-and-deployments/preview-urls/)
- [`global_fetch_strictly_public`](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#global-fetch-strictly-public)
- [Cloudflare Access self-hosted applications](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)
- [Validate Cloudflare Access JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [OpenNext for Cloudflare](https://opennext.js.org/cloudflare)
- [OpenNext custom Worker](https://opennext.js.org/cloudflare/howtos/custom-worker)

## 1. Prepare the repository

Install Node.js 22 or newer, clone the repository, and install the locked
dependencies:

```bash
git clone https://github.com/Coke1120/HushLedger.git
cd HushLedger
npm ci
npm run db:local
npm run verify
npm audit --omit=dev --audit-level=high
```

The local migration command uses Wrangler's local D1 state. It does not modify
your Cloudflare account.

## 2. Sign in and create D1

Authenticate in your browser and confirm the intended account:

```bash
npx wrangler login
npx wrangler whoami
```

For a new installation, create D1 and let Wrangler replace the checked-in
placeholder:

```bash
npx wrangler d1 create hushledger --binding DB --update-config
```

For an existing database, do not run the create command. Find the intended
database with `npx wrangler d1 list`, then replace only the placeholder
`database_id` in `wrangler.jsonc`. In either case, verify this final shape:

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

The binding must stay named `DB`, `migrations_dir` must remain `migrations`, and
the placeholder must be gone before deployment. The database ID is deployment
metadata, not a password. Do not paste tokens or secrets into this file.

## 3. Apply remote migrations

For a new empty database, inspect the pending list and apply all migrations:

```bash
npx wrangler d1 migrations list hushledger --remote
npx wrangler d1 migrations apply hushledger --remote
```

For an existing database, export a backup first and read every new migration.
D1 records applied migrations, so always add a new numbered migration instead
of editing a migration that production has already applied.

Do not deploy a build containing saved AI settings until
`0021_ai_provider_settings.sql` appears in the applied migration list. On an
existing Worker, also configure `AI_SETTINGS_ENCRYPTION_KEY_V1` as described in
[Step 8](#8-use-ai-drafts-safely) before deploying the updated code.

## 4. Create the Worker without a public route

The checked-in configuration explicitly sets both `workers_dev` and
`preview_urls` to `false` and does not contain a route. Run the quality gate,
then build Next.js, adapt it with OpenNext, and create/update the Worker in this
intentionally unreachable state:

```bash
npm run verify
npm run deploy
```

OpenNext uploads the App Router application, Route Handlers, Server Actions, PWA
assets, and the custom Worker that validates Access JWTs and handles Cron. This
configuration must not create a `workers.dev`, preview, custom-domain, or route
entry point. In **Workers & Pages > HushLedger > Settings > Domains & Routes**,
verify `workers.dev` and Preview URLs are disabled and no route is attached. Stop
if any public hostname exists.

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
2. In Zero Trust, open **Access controls > Applications**, select **Create new
   application**, choose **Self-hosted and private**, then **Add public hostname**
   for that exact HushLedger hostname.
3. Add an **Allow** policy limited to your intended identity, such as one exact
   email address or a tightly scoped identity-provider group.
4. Keep the default-deny behavior for everyone else and require your identity
   provider's strong authentication or MFA.
5. Make sure the application covers both `/` and `/api/*`. A path-specific
   policy must not leave another path public.
6. Reconfirm the checked-in `workers_dev: false` and `preview_urls: false` values.
7. Do not attach the custom domain or route yet, and do not enable either
   alternate URL.

Before attaching the hostname, configure the two values that the custom Worker
uses to cryptographically verify Access tokens:

1. In **Zero Trust > Settings**, copy the team domain including `https://` (for
   example, `https://your-team.cloudflareaccess.com`).
2. Configure the HushLedger Access application, open **Additional settings**, and
   copy its Application Audience (AUD) tag.
3. Store both values on the already-created Worker:

   ```bash
   npx wrangler secret put CF_ACCESS_TEAM_DOMAIN
   npx wrangler secret put CF_ACCESS_AUD
   ```

These values identify the expected issuer and application. Outside localhost,
HushLedger fails closed when either value is absent or when the JWT signature,
issuer, audience, or lifetime is invalid.

Each `wrangler secret put` command creates and deploys a new Worker version.
Before attaching the hostname, recheck **Domains & Routes** and confirm that
`workers.dev` and Preview URLs remain disabled and no route or custom domain has
appeared.

Only now attach the exact custom domain or route covered by the Access
application. Keep both alternate Worker URL types disabled.

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

For routine app-level portability, Settings can download a versioned JSON file
covering the reporting currency, accounts, categories, emergency-fund checkpoint,
recurring transaction and transfer rules, transactions, account transfers, import
tombstones, and any explicitly fetched ECB reference-rate observations. See the
[backup format and compatibility contract](../README.md#ledger-backup-and-restore)
for the current schema and exclusions. The file is plaintext even though it has a
SHA-256 integrity check, so move it immediately to encrypted storage. The in-app
restore validates and previews first, but it still replaces the current ledger;
use a separate test deployment for restore drills.

Account opening balances and their dates are part of the account rows in this
backup. After migration `0012`, verify one account-balance panel against a known
statement in the test deployment. **Compare statement** opens the account's
monthly register so uncleared entries can be reviewed beside the exact difference.
If the selected period or 200-row screen cap cannot contain every uncleared item,
use the explicit **Load every uncleared entry** action to retrieve a private,
uncapped snapshot through the statement close. This can expose older out-of-period
financial details in the current screen, but it is not stored in browser storage or
sent to a third party. The statement value itself is not stored; only an opening
balance or an account-bound posting-status change deliberately saved by the user is
persisted.

Create an encrypted, off-platform backup before migrations and on a regular
schedule. This database-level SQL export remains the recovery path for backups
larger than the 7 MiB in-app limit and for complete operational archives:

```bash
mkdir -p backups
npx wrangler d1 export hushledger --remote --output="backups/hushledger-$(date +%Y%m%d-%H%M%S).sql"
```

The `backups/` directory is ignored by Git, but that is not encryption. Encrypt
the export and copy it to storage outside Cloudflare. Periodically restore into
a separate test database and compare table counts, monthly summaries, and a
small sample of fictional or redacted records. Never test a restore by
overwriting the only production database.

Cloudflare D1 Time Travel is an additional recovery layer, not a replacement for
off-platform backups. Record the current bookmark before any production restore
so the restore itself can be reversed if necessary. See Cloudflare's
[Time Travel documentation](https://developers.cloudflare.com/d1/reference/time-travel/).

The app-level JSON backup deliberately excludes AI provider settings. A full D1
export and Time Travel history can retain that separate row: the base URL and
model remain readable configuration, while the provider API key is retained only
as AES-GCM ciphertext with its IV and encryption-key version. Protect these copies
as sensitive data even though they do not contain the plaintext provider key.

## 8. Use AI drafts safely

AI bank-record draft parsing is optional. Each user enters an OpenAI-compatible
base URL, API key, and model in Settings and can keep them only in the current tab.
This memory-only mode clears on reload and requires no encryption secret.

To allow explicit persistence, create an independent 32-byte encryption key and
store it as a per-Worker secret. This command pipes the generated value directly
to Wrangler, so the value is not printed or included in shell history:

```bash
openssl rand -hex 32 | npx wrangler secret put AI_SETTINGS_ENCRYPTION_KEY_V1
```

The value must be exactly 64 hexadecimal characters. Do not place it in
`wrangler.jsonc`, an environment variable committed to the repository, or D1.
For local persistence, put a separately generated value in the Git-ignored
`.dev.vars` file beside `wrangler.jsonc`:

```dotenv
AI_SETTINGS_ENCRYPTION_KEY_V1=<output of openssl rand -hex 32>
```

Never commit the file or value. Losing or replacing the secret makes the existing
saved API-key ciphertext undecryptable. After an intentional key change, enter and
save the provider key again.

Saved settings keep the base URL and model in D1 and the API key only as AES-GCM
ciphertext. Browser and settings API responses expose only redacted metadata such
as whether a key is configured; AI proxy routes load and decrypt the credential
server-side. Plaintext provider keys are not persisted in browser storage, cookies,
D1, Worker globals, or logs.

For a Cloudflare deployment, the provider must use a public HTTPS hostname on
port 443. A deployed Worker cannot call a model running on the user's localhost
or LAN. Browser requests remain same-origin to HushLedger; the server proxies only
fixed `/models` and `/chat/completions` paths, rejects redirects and private
targets, and preserves `private, no-store` responses. Keep the
`global_fetch_strictly_public` compatibility flag enabled.

Use only a provider hostname you trust. Local Next.js development does not
DNS-pin arbitrary public hostnames; the production Worker flag above keeps
outbound `fetch()` on Cloudflare's public-Internet routing path.

Never place an AI API key in React source, client environment variables,
`wrangler.jsonc`, a GitHub issue, build logs, screenshots, or test fixtures. The
key being typed into the runtime password field is intentional BYOK input; it is
not embedded in the client bundle. Deleting the saved settings row does not revoke
the upstream credential; rotate or revoke it at the provider for immediate
invalidation. See
[AI_BANK_IMPORT_PLAN.md](../AI_BANK_IMPORT_PLAN.md) for the no-write draft boundary.

## Deployment checklist

- [ ] `npm run verify` succeeds from a clean checkout.
- [ ] The production dependency audit has no high-severity finding.
- [ ] Remote D1 migrations are applied to the intended database.
- [ ] Migration `0021_ai_provider_settings.sql` was applied before deploying code
      that persists AI settings.
- [ ] The D1 binding is `DB`, the placeholder is gone, and `database_id` contains
      no token or secret.
- [ ] Initial deploy has no `workers.dev`, preview, custom-domain, or route URL.
- [ ] Access policy exists before the custom hostname is attached.
- [ ] `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` are configured on the Worker.
- [ ] `AI_SETTINGS_ENCRYPTION_KEY_V1` is configured as a 64-hex-character Worker
      secret before saved AI settings are enabled.
- [ ] Alternate Worker URLs are still disabled after secret updates and every
      later deployment.
- [ ] A missing or invalid Access JWT is rejected by the custom Worker.
- [ ] The custom hostname, `/api/*`, and every alternate hostname are private.
- [ ] An unauthorized session is blocked by Access.
- [ ] An authorized end-to-end transaction and recurring-rule flow succeeds.
- [ ] The same due-run does not duplicate a recurring occurrence.
- [ ] An encrypted off-platform backup and restore drill exist.
- [ ] Real financial data and secrets are absent from Git, logs, screenshots,
      issues, and pull requests.
