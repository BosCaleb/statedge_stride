# Deploying Stride on Azure

Step by step from an empty subscription to a working dev and prod environment, and what it is expected to cost in South Africa North. The templates are in `infra/` (Bicep); `infra/README.md` describes what they create, and `docs/runbook.md` covers day-to-day operation.

Everything runs in **South Africa North** except the Static Web App, which Azure does not offer there; it runs in West Europe and only serves static files. Coaches' video never leaves their phones, so the cloud side is small: a static site, a serverless API and a small database.

## What you need first

- An Azure subscription where you are **Owner** (the templates create a custom role, role assignments and a lock).
- The **Azure CLI** 2.53 or later (`az login`), the **GitHub CLI** (`gh auth login`) signed in as an administrator of `BosCaleb/statedge_stride`, and `jq`.
- Access to the DNS for `statedge.co.za` at GoDaddy, for the custom domain.
- About two hours for the first environment. Prod follows the same steps.

Check once that the services are offered where we need them:

```bash
az functionapp list-consumption-locations --query "[?name=='South Africa North']" -o table
```

If Linux Consumption (Y1) is no longer listed for South Africa North, stop and choose Flex Consumption instead (see `docs/roadmap.md`, Cost, speed and operations).

## Step 1: Sign-in (Entra External ID), once per environment

Bicep cannot manage the external tenant, so this is done by hand in the Entra admin centre. Full detail is in `docs/runbook.md`, "Entra External ID".

1. Create an **External ID external tenant** for StatEdge customers. Note its **tenant id** and **subdomain** (`<subdomain>.ciamlogin.com`).
2. Register **`stride-api`**: expose the scope `access_as_user`, and set `requestedAccessTokenVersion` to 2 in the manifest. Note its **client id**.
3. Register **`stride-web`** as a single-page application with the redirect URI `https://<web-origin>/auth/callback` (and `http://localhost:5173/auth/callback` for dev). Grant it the delegated permission `stride-api/access_as_user`.
4. Create a **sign-up and sign-in user flow** with email one-time passcode and add `stride-web` to it. Add the `email` optional claim to both registrations.
5. Apply StatEdge branding to the sign-in pages.

You do not know the web origin until step 3 has run once. Use the Static Web App hostname the deploy script prints, then add the custom domain later.

## Step 2: Fill in the environment settings

Edit `infra/environments/dev.bicepparam` (later `prod.bicepparam`). None of it is secret; commit it.

| Setting                        | Value                                                                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `owner`, `alertEmail`          | Who owns the resources and gets budget and alert emails                                                                      |
| `budgetStartDate`              | The first day of next month, for example `2026-11-01T00:00:00Z`                                                              |
| `entraTenantId`                | The External ID tenant id from step 1                                                                                        |
| `entraApiClientId`             | The `stride-api` client id from step 1                                                                                       |
| `sqlStaffUsers`                | Each StatEdge person who runs the staff scripts, with their Entra object id (`az ad user show --id <upn> --query id -o tsv`) |
| `githubReviewerUserIds` (prod) | GitHub user ids who approve production deploys (`gh api users/<login> --jq .id`)                                             |
| `customDomain` (prod)          | `stride.statedge.co.za`, with `customDomainDnsReady = false` at first                                                        |

## Step 3: Deploy the infrastructure

Preview first, then deploy:

```bash
infra/deploy.sh dev --what-if
```

```bash
infra/deploy.sh dev
```

The script deploys `infra/main.bicep` at subscription scope (a few minutes), then configures the GitHub environment `dev`: deployments only from the `dev` branch, and the variables the deploy workflow reads. GitHub holds no secret: the workflow signs in with OIDC and reads the Static Web App token at deploy time. At the end it prints the API URL, the Application Insights connection string and the web hostname.

Running it again is safe: it converges on the same result and keeps the settings a code deployment added.

## Step 4: Fill in the web app settings

In `apps/web/.env.dev` (later `.env.prod`), replace every `REPLACE_ME`:

| Setting                                 | From                                          |
| --------------------------------------- | --------------------------------------------- |
| `VITE_API_BASE_URL`                     | Printed by the deploy script                  |
| `VITE_ENTRA_TENANT_SUBDOMAIN`           | Step 1                                        |
| `VITE_ENTRA_CLIENT_ID`                  | The `stride-web` client id                    |
| `VITE_API_SCOPE`                        | `api://<stride-api client id>/access_as_user` |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | Printed by the deploy script                  |

Also add the printed web hostname as a redirect URI on `stride-web` if you used a placeholder in step 1.

## Step 5: Deploy the code

Push to `dev`. The Deploy dev workflow runs CI, then:

1. refuses to deploy if a setting still holds `REPLACE_ME` or a test-only switch is on;
2. signs in to Azure with OIDC and checks the Function App settings;
3. runs the database migrations, which create the database users for the API identity and the staff from their Entra ids;
4. deploys the API, reads the Static Web App token and deploys the web app;
5. waits until `/v1/health` reports the new build, and checks the content security policy;
6. runs the OWASP ZAP baseline scan (dev only).

## Step 6: Check it end to end

1. Open the web hostname on a phone and sign in with an email passcode. You will see "not enrolled" until step 7.
2. Create the first organisation and its admin invite (your Entra account has database access through `sqlStaffUsers`):

   ```bash
   export ENVIRONMENT=dev SQL_SERVER=sql-stride-dev-san.database.windows.net SQL_DATABASE=sqldb-stride-dev-san
   pnpm create-org --name "StatEdge test" --type club --admin-email you@statedge.co.za --seats 3 --web-origin https://<web-hostname>
   ```

3. Accept the invite, add an athlete with consent, import and analyse a clip, save it, and see it in the athlete's history.
4. Set up a free external uptime monitor on `https://func-stride-dev-san.azurewebsites.net/api/v1/health`.

## Step 7: Production

Repeat steps 1 to 6 for `prod` with `prod.bicepparam`, `.env.prod` and a push to `main`. The prod deploy waits for a listed reviewer to approve it. Then add the custom domain:

1. At GoDaddy, add a CNAME from `stride` to the prod web hostname the script printed.
2. Set `customDomainDnsReady = true` in `prod.bicepparam` and run `infra/deploy.sh prod` again.
3. Add `https://stride.statedge.co.za/auth/callback` to the `stride-web` redirect URIs.

## Step 8: Before the pilot

- Decide what the prod database does when its free monthly compute runs out (below). The template pauses it, which takes the API offline until the next month.
- Triage the ZAP findings, try to break organisation scoping, and have the privacy notice and consent wording reviewed (POPIA).
- Check the first Azure invoice for anything unexpected, especially Entra add-ons.

## Estimated cost in South Africa North

### How the estimate was made

These are estimates in US dollars from Azure's published pay-as-you-go list prices and free allowances, with rand amounts at an assumed **R18 to the dollar**. South Africa North list prices usually sit 15 to 25 percent above US East, and both prices and the exchange rate change. The live price list could not be read when this was written, so confirm the paid lines in the [Azure pricing calculator](https://azure.microsoft.com/pricing/calculator/) with region South Africa North before the pilot. Prices exclude VAT.

### What is free

| Service                                | Free allowance                                                                                                                          | Stride's use                                                |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Static Web Apps, Free plan             | Free, including custom domain and certificate, 100 GB bandwidth a month                                                                 | The web app and the public report viewer                    |
| Functions, Consumption plan            | 1 million executions and 400,000 GB-seconds a month, per subscription                                                                   | The API; a pilot uses a few percent of this                 |
| Azure SQL Database free offer          | Per database each month: 100,000 vCore-seconds of compute, 32 GB of data and 32 GB of backup (up to 10 such databases per subscription) | One database each for dev and prod                          |
| Entra External ID                      | The first 50,000 monthly active users                                                                                                   | Coaches; email passcodes are free, SMS is not               |
| Log Analytics and Application Insights | The first 5 GB of ingestion a month per billing account                                                                                 | Capped at 0.1 GB a day per environment (about 3 GB a month) |
| Budgets, action group emails           | Free                                                                                                                                    | Budget and alert emails                                     |
| Data out to the internet               | The first 100 GB a month                                                                                                                | Small: reports, keypoints and API answers                   |

### What costs money

| Item                                                                   | Approximate price                                                 | Expected use                   |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------ |
| Metric alert rules                                                     | About US$0.10 per rule a month                                    | 4 per environment              |
| Daily log query alert                                                  | Under US$0.50 a month                                             | 1 per environment              |
| Storage account (Functions host and deployment packages)               | About US$0.02 to 0.03 per GB a month, plus transactions           | Well under 1 GB                |
| SQL compute beyond the free allowance (only if billing is switched on) | About US$0.0002 per vCore-second (roughly US$0.65 per vCore-hour) | See the note below             |
| SQL storage beyond 32 GB                                               | About US$0.13 per GB a month                                      | Not expected in the first year |
| Static Web Apps Standard (optional, for an SLA)                        | US$9 per app a month                                              | Not needed for the pilot       |

### Monthly estimate

| Scenario                                      | What it assumes                                                                                   | US$ a month                                                     | Rand a month       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------ |
| Dev and prod, idle or light pilot             | A few organisations and coaches; databases awake about an hour a day; within every free allowance | About 1 to 2                                                    | About R20 to R40   |
| Busy pilot, free database paused when used up | As above, but prod is in use most afternoons; prod pauses when the free compute runs out          | About 1 to 2, but the API is offline for the rest of that month | About R20 to R40   |
| Busy pilot, prod billing switched on          | Prod awake about 4 hours a day at 0.5 vCore; compute beyond the free amount is billed             | About 15 to 30                                                  | About R270 to R540 |
| Busy pilot with an SLA web plan               | As above, plus Static Web Apps Standard for prod                                                  | About 25 to 40                                                  | About R450 to R720 |

The resource-group budget in the templates is US$15 per environment, with emails at 50, 80 and 100 percent.

### The one cost to watch: database compute

The free 100,000 vCore-seconds a month is about 55 hours at the serverless minimum of 0.5 vCore. The database only counts time while it is awake, and it pauses after 60 minutes without a request (`autoPauseDelay` in `infra/modules/stride.bicep`). Each burst of coach activity keeps it awake for at least an hour, so roughly **an hour and three quarters of awake time a day** fits in the free amount.

- **Dev** can stay on pause-when-exhausted: if it runs out, it waits for the next month.
- **Prod**, once coaches rely on it, should change `freeLimitExhaustionBehavior` from `AutoPause` to `BillOverUsage`. Paid compute is then billed at the serverless rate, about US$0.33 an hour at 0.5 vCore. The template already alerts when less than 20 percent of the free amount is left.
- A shorter auto-pause delay stretches the free amount further, at the cost of a slower first request after a pause: the database takes up to a minute to resume, so that first request can time out. Saves go through the outbox, which retries them; a screen that was loading shows a retry.

### Things that would raise the cost later

- SMS or other paid sign-in methods in External ID.
- Clip upload to Blob Storage (stretch): about US$0.02 to 0.03 per GB a month, so a few hundred clips cost cents. Bandwidth matters more if clips are replayed often.
- Moving to Flex Consumption: its free grant is smaller (100,000 GB-seconds and 250,000 executions a month), still more than a pilot needs.
- A paid Postgres Flexible Server instead of the free SQL database: from roughly US$15 to 30 a month for the smallest burstable size.
