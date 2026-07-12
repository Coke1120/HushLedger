# The easiest safe way to deploy HushLedger

This guide is for a first-time, personal HushLedger installation. You do not
need Git or programming experience. You will download a ZIP file, paste a few
commands, and click through Cloudflare's dashboard.

> **Privacy first:** Do not enter real financial data until the final private-
> browser test shows the Cloudflare sign-in page before HushLedger.

## What you need

- A Mac or Windows computer.
- A [Cloudflare account](https://dash.cloudflare.com/sign-up).
- A domain already active in that Cloudflare account, such as `example.com`.
  This guide will use a private address such as `money.example.com`. If needed,
  follow Cloudflare's [add a domain guide](https://developers.cloudflare.com/fundamentals/manage-domains/add-site/)
  first. Choose a new subdomain that is not already connected to another site
  or service.
- One exact email address that will be allowed to open HushLedger. Using the
  email for your Cloudflare account is the simplest choice.
- [Node.js](https://nodejs.org/en/download) 22 or newer. Choose the current LTS
  installer and keep its normal installation options.

This guide assumes that your Cloudflare account does not already contain a D1
database or Worker named `hushledger`. If either one already exists, use the
[advanced deployment guide](CLOUDFLARE_SETUP.md) instead so that you do not
change an existing installation by accident. You can check by searching for
`hushledger` under **Workers & Pages** and **D1 SQL Database** in the Cloudflare
dashboard.

## The two parts

1. Upload HushLedger and create its database.
2. Put a private sign-in screen in front of it before giving it a web address.

GitHub stores the source code. It does not deploy the app for you.

## 1. Download HushLedger

1. Open the [HushLedger GitHub page](https://github.com/Coke1120/HushLedger).
2. Select the green **Code** button.
3. Select **Download ZIP**.
4. Open the downloaded ZIP file to extract the `HushLedger-main` folder.

Keep this folder after deployment. It contains the settings used to update your
installation later.

## 2. Open a terminal in the folder

A terminal is the small text window where you will paste the commands below.
Paste one command at a time and press Enter or Return.

### On Windows

1. Open the extracted `HushLedger-main` folder in File Explorer.
2. Select the address bar at the top of the window.
3. Type `cmd` and press Enter.

### On macOS

1. Open **Terminal** from Applications > Utilities.
2. Type `cd` followed by one space, but do not press Return yet.
3. Drag the extracted `HushLedger-main` folder into the Terminal window.
4. Press Return.

You are in the correct folder when it contains files named `README.md`,
`package.json`, and `wrangler.jsonc`.

## 3. Install HushLedger's required packages

Paste:

```bash
npm ci
```

Wait until the command finishes and the terminal is ready for another command.
Warnings about funding are harmless. If the terminal says that `npm` is not
recognized or not found, install Node.js from the link above, close the terminal,
open it again, and repeat Step 2.

## 4. Sign in to Cloudflare

Paste:

```bash
npx wrangler login
```

Your browser will open. Sign in to Cloudflare and approve Wrangler. Wrangler is
Cloudflare's official deployment tool included with HushLedger.

Return to the terminal and paste:

```bash
npx wrangler whoami
```

Check that it shows the Cloudflare account that owns your domain. Do not continue
with the wrong account. If several accounts appear and you are not certain which
one Wrangler will use, stop and use the
[advanced deployment guide](CLOUDFLARE_SETUP.md).

Before creating anything, open the Cloudflare dashboard and perform this final
check:

1. Open **Workers & Pages > Overview** and look for the exact name `hushledger`.
2. Open **D1 SQL Database** and look for the exact name `hushledger`.
3. If either one exists, stop and use the advanced guide. The next commands are
   only for a new installation.

## 5. Create and connect the database

Paste this one command:

```bash
npx wrangler d1 create hushledger --binding DB --update-config
```

This creates the private D1 database and connects it to HushLedger automatically.
You do not need to copy a database ID or edit any file.

Continue only after the terminal says that the database was created. If it says
that `hushledger` already exists, stop and use the
[advanced deployment guide](CLOUDFLARE_SETUP.md).

## 6. Prepare the database tables

Paste:

```bash
npx wrangler d1 migrations apply hushledger --remote
```

If Cloudflare asks for confirmation, check that the database name is
`hushledger`, then answer `y`. Wait for the migrations to finish successfully.

## 7. Build and upload HushLedger

First build the app:

```bash
npm run build
```

When it finishes, upload it:

```bash
npx wrangler deploy
```

It is normal if no working website address appears yet. HushLedger intentionally
keeps `workers.dev` and preview addresses off, so the new app stays unreachable
while you prepare its sign-in protection.

In the Cloudflare dashboard, open **Workers & Pages > hushledger > Settings >
Domains & Routes**. Confirm that **workers.dev** and **Preview URLs** are disabled
and that no custom domain is attached yet.

## 8. Set up the private sign-in screen

Open **Zero Trust** from the Cloudflare dashboard. On first use, Cloudflare may
ask you to create an organization name and choose a plan. Follow its current
on-screen setup, then continue below.

### Choose how you will sign in

New Zero Trust organizations normally show **Cloudflare** as an identity
provider. If you will sign in with the same Cloudflare account email, keep that
option.

To receive a one-time code by email instead:

1. Open **Zero Trust > Integrations > Identity providers**.
2. Under **Your identity providers**, select **Add new identity provider**.
3. Select **One-time PIN** and save it.

### Protect your future HushLedger address

1. Open **Zero Trust > Access controls > Applications**.
2. Select **Create new application**.
3. Select **Self-hosted and private**.
4. Select **Add public hostname**.
5. Name the application `HushLedger`.
6. Enter the address you want to use, such as `money.example.com`. Select your
   Cloudflare domain and enter the subdomain. Leave the path empty so the whole
   app, including `/api`, is protected.
7. Create an Access policy with these exact choices:
   - Policy name: `Only me`
   - Action: **Allow**
   - Include selector: **Emails**
   - Value: your one exact email address
8. Select the **Cloudflare** or **One-time PIN** identity provider you prepared.
9. Leave the other settings at their defaults and select **Create**.

> **Do not choose `Everyone`. Do not create an Allow rule that uses only
> `Login Methods`.** Either choice can allow many more people than your one exact
> email address.

Cloudflare Access denies anyone who does not match your **Only me** policy.

## 9. Give the protected app its web address

Only do this after the Access application from Step 8 exists.

1. In Cloudflare, open **Workers & Pages > hushledger > Settings > Domains &
   Routes**.
2. Select **Add**, then **Custom Domain**.
3. Enter the exact same address used in Access, such as `money.example.com`.
4. Confirm the change.

Cloudflare creates the required DNS record and security certificate. Do not turn
on a `workers.dev` or Preview URL, because those are separate addresses that are
not covered by the custom-domain rule you just created.

## 10. Perform the privacy check

1. Open a new private or incognito browser window.
2. Visit `https://money.example.com/api/health`, replacing the example address
   with yours.
3. You must see a Cloudflare sign-in page, not HushLedger data or a JSON result.
4. Sign in with the exact allowed email. If you use One-time PIN, Cloudflare will
   email a single-use code that expires after 10 minutes.
5. Visit your main address, such as `https://money.example.com`.
6. Confirm that the HushLedger dashboard opens.

If HushLedger appears before Cloudflare asks you to sign in, immediately remove
the Custom Domain from **Domains & Routes** and fix the Access application before
using the app.

Only after this test passes should you enter real financial data.

## You are live

Save these three details somewhere private:

- Your HushLedger address.
- The exact email allowed by Cloudflare Access.
- The location of your extracted `HushLedger-main` folder.

HushLedger does not need an app password, AI key, or banking password. AI bank-
record import is not enabled in the current release. Never paste banking records,
API keys, passwords, or Cloudflare tokens into GitHub issues or screenshots.

For updates, backups, recovery tests, and more advanced security options, use the
[advanced Cloudflare deployment guide](CLOUDFLARE_SETUP.md).

## Quick troubleshooting

| What you see | What to do |
| --- | --- |
| `npm` is not recognized or not found | Install the current Node.js LTS version, close the terminal, reopen it, and repeat Step 2. |
| `package.json` cannot be found | The terminal is in the wrong folder. Repeat Step 2 and make sure you opened `HushLedger-main`. |
| Wrangler shows the wrong Cloudflare account | Run `npx wrangler logout`, then repeat Step 4 with the account that owns your domain. |
| A database or Worker named `hushledger` already exists | Stop. Use the advanced guide so that you do not overwrite an existing installation. |
| No one-time code arrives | Confirm that the Access policy uses your exact email, check spam, and request a fresh code. Each code is single-use and expires after 10 minutes. |
| Cloudflare says the custom domain already has a DNS or CNAME record | Choose a new, unused subdomain. Do not delete an existing record unless you know what service depends on it. |
| The custom domain is still unavailable | Wait a few minutes, then confirm that the hostname in Access and the hostname in Domains & Routes are identical. |
| HushLedger opens without a Cloudflare sign-in screen | Remove the Custom Domain immediately, then correct the Access application and exact-email policy before reconnecting it. |

## Official Cloudflare references

- [Create a D1 database](https://developers.cloudflare.com/d1/get-started/)
- [Apply D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [Publish and protect a self-hosted application](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)
- [One-time PIN login](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)
- [Add a Worker Custom Domain](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
