# Runbook

How to set up, run, deploy and operate StatEdge Stride. Infrastructure provisioning is in `infra/README.md`; decisions are in `docs/decisions.md`.

## Local development

Needs Node 22 (`.nvmrc`), pnpm 10 (`corepack enable`), Docker, and optionally Azure Functions Core Tools 4.

```bash
pnpm install
pnpm db:up          # SQL Server 2022 in Docker
pnpm db:migrate     # creates the stride database and the stride_api login, applies migrations
pnpm seed           # two organisations, coaches, athletes and consents
pnpm fetch-models   # the pinned pose model and WASM runtime, checksummed, into apps/web/public/models
pnpm dev            # web on http://localhost:5173, API on http://localhost:7071/api
```

`pnpm dev` signs in with fake identities (the seeded people listed by `pnpm seed`), because `apps/api/local.settings.json` sets `DEV_FAKE_AUTH=true` and `apps/web/.env.development` sets `VITE_FAKE_AUTH=true`. The API honours fake tokens only when `ENVIRONMENT=local`. To sign in with a real Entra tenant locally, put the tenant settings in `apps/web/.env.development.local` and set `DEV_FAKE_AUTH=false` with the tenant's `ENTRA_TENANT_ID` and `ENTRA_API_AUDIENCE` in `local.settings.json`.

The local API connects as `stride_api`, a login with the same rights as the Function App's identity, so row-level security applies locally exactly as in Azure.

Checks before a push: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:db` (needs `pnpm db:up`), and for the web app `pnpm --filter @stride/web build:e2e && pnpm e2e`. After changing a request or response schema, run `pnpm openapi` and commit `apps/api/openapi.json`.

To try the analysis on a phone against the local dev server, see `docs/spike-report.md` (it uses `adb reverse` so that the phone sees a secure `localhost` origin).

## Entra External ID (one time per environment, by hand)

The Terraform provider does not manage the external tenant. For each of dev and prod:

1. Create an External ID external tenant for StatEdge customers. Note its tenant id and its subdomain (`<subdomain>.ciamlogin.com`).
2. Register the API `stride-api`: expose the scope `access_as_user`, and set `requestedAccessTokenVersion` to 2 in the manifest. Its client id is the token audience (`entra_api_client_id` in Terraform).
3. Register the single-page application `stride-web` with redirect URIs ending in `/auth/callback` for the environment's web origin (and `http://localhost:5173/auth/callback` for dev). Grant it the delegated permission `stride-api/access_as_user`.
4. Create a sign-up and sign-in user flow with email one-time passcode, and add `stride-web` to it. Social sign-in is optional. Add the `email` optional claim to the tokens of both registrations.
5. Apply StatEdge branding (logo, navy and orange) to the sign-in pages.
6. Fill in `apps/web/.env.<env>`: `VITE_ENTRA_TENANT_SUBDOMAIN`, `VITE_ENTRA_CLIENT_ID` (stride-web), `VITE_API_SCOPE` (`api://<stride-api client id>/access_as_user`).

## Deploying

- Push to `dev`: CI runs, then the dev deploy (migrations, API, web, health check, ZAP baseline scan).
- Push to `main`: CI runs, then the prod deploy waits for a reviewer's approval in the `prod` GitHub environment.

Each deploy uses the artefacts built and tested in the same run. Migrations run before the new API is deployed, so every migration must work with the previous API version: add columns before using them, never rename in one step.

The deploy fails on purpose when `apps/web/.env.<env>` still holds `REPLACE_ME`, enables a test-only switch, or when `DEV_FAKE_AUTH` is set on the Function App or as a GitHub variable.

## Staff tasks

Run against Azure after `az login`, with the environment's database:

```bash
export ENVIRONMENT=prod SQL_SERVER=sql-stride-prod-san.database.windows.net SQL_DATABASE=sqldb-stride-prod-san
pnpm create-org --name "Ridge High School" --type school --admin-email head.coach@ridge.example --seats 3 \
  --web-origin https://stride.statedge.co.za
```

`create-org` prints the first admin's invite link once; send it by WhatsApp or email. Your Entra account needs database access: add your UPN to `sql_staff_users` in the environment's Terraform variables, apply, and deploy once (the deploy grants it).

## Monitoring

Alerts email the founder: API 5xx responses, failing invocations, daily executions approaching the free grant, less than 20 percent of the free database compute left this month, and the log ingestion cap reached, plus the US$15 resource-group budget at 50, 80 and 100 percent.

Set up a free external uptime monitor (for example UptimeRobot) on `https://func-stride-prod-san.azurewebsites.net/api/v1/health` every five minutes. It needs no credentials.

When a coach reports a problem, ask for the support code from the error screen. It holds the build and the time, which narrows the Application Insights search; it never holds personal data.

## If the free database allowance runs out

The database pauses until the next month (`AutoPause`). To keep it running, switch the free-limit exhaustion behaviour to bill for overage in the portal (General Purpose serverless rates), or wait for the reset. Longer term, see the upgrade path in the spec's cost guardrails.
