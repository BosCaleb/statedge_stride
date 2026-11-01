# Runbook

How to set up, run, deploy and operate StatEdge Stride. Infrastructure provisioning is in `infra/README.md`; decisions are in `docs/decisions.md`.

## Local development

Needs Node 22 (`.nvmrc`), pnpm 10 (`corepack enable`), Docker, and optionally Azure Functions Core Tools 4.

```bash
pnpm install
pnpm db:up          # SQL Server 2022 in Docker
pnpm db:migrate     # creates the stride database and the stride_api login, applies migrations
pnpm seed           # two organisations, coaches, athletes and consents
pnpm fetch-models   # the pinned pose models, runner detector and WASM runtime, checksummed, into apps/web/public/models
pnpm dev            # web on http://localhost:5173, API on http://localhost:7071/api
```

`pnpm dev` signs in with fake identities (the seeded people listed by `pnpm seed`), because `apps/api/local.settings.json` sets `DEV_FAKE_AUTH=true` and `apps/web/.env.development` sets `VITE_FAKE_AUTH=true`. The API honours fake tokens only when `ENVIRONMENT=local`. To sign in with a real Entra tenant locally, put the tenant settings in `apps/web/.env.development.local` and set `DEV_FAKE_AUTH=false` with the tenant's `ENTRA_TENANT_ID` and `ENTRA_API_AUDIENCE` in `local.settings.json`.

The local API connects as `stride_api`, a login with the same rights as the Function App's identity, so row-level security applies locally exactly as in Azure.

Checks before a push: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:db` (needs `pnpm db:up`), and for the web app `pnpm --filter @stride/web build:e2e && pnpm e2e`. After changing a request or response schema, run `pnpm openapi` and commit `apps/api/openapi.json`.

To try the analysis on a phone against the local dev server, see `docs/spike-report.md` (it uses `adb reverse` so that the phone sees a secure `localhost` origin).

## Entra External ID (one time per environment, by hand)

The Bicep templates do not manage the external tenant, which has no Azure subscription. For each of dev and prod:

1. Create an External ID external tenant for StatEdge customers. Note its tenant id and its subdomain (`<subdomain>.ciamlogin.com`).
2. Register the API `stride-api`: expose the scope `access_as_user`, and set `requestedAccessTokenVersion` to 2 in the manifest. Its client id is the token audience (`entraApiClientId` in `infra/environments/<env>.bicepparam`).
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

`create-org` prints the first admin's invite link once; send it by WhatsApp or email. Your Entra account needs database access: add your UPN and object id (`az ad signed-in-user show --query id`) to `sqlStaffUsers` in `infra/environments/<env>.bicepparam`, run `infra/deploy.sh <env>`, and deploy once (the deploy grants it).

## Monitoring

Alerts email the founder: API 5xx responses, failing invocations, daily executions approaching the free grant, less than 20 percent of the free database compute left this month, and the log ingestion cap reached, plus the US$15 resource-group budget at 50, 80 and 100 percent.

Set up a free external uptime monitor (for example UptimeRobot) on `https://func-stride-prod-san.azurewebsites.net/api/v1/health` every five minutes. It needs no credentials.

When a coach reports a problem, ask for the support code from the error screen. It holds the build and the time, never personal data, and the web app sends it to Application Insights with the error. In the portal, open `appi-stride-<env>-san` → Logs and run:

```kusto
exceptions | where customDimensions.supportCode == "<the code>"
```

What the web app sends (docs/decisions.md D112): unhandled errors and errors caught by the error screens (`exceptions`), failed API calls by route name (`dependencies`, never a URL), and three events (`customEvents`): `analysis_completed` (mode, quality result, duration, frame count, frame rate, phone family), `analysis_failed` (the failure code) and `device_check` (the result). No page views, no user or session ids, no cookies. Every item passes the scrubbing initialiser in `apps/web/src/lib/telemetryScrub.ts` on the phone first.

### The retention sweep

`retention-sweep` runs daily at 00:00 UTC (02:00 in South Africa). Per organisation it deletes expired and revoked share links with their frames, expired invites, and audit rows older than 24 months, and writes one `retention.sweep` audit row with the counts when it deleted anything. To check the last runs:

```kusto
traces | where message has '"event":"retention.sweep' | order by timestamp desc | take 10
```

A run that failed for an organisation logs `retention.sweep.failed` with the organisation id and fails the invocation, which raises the failing-invocations alert. The next night's run catches up on its own; nothing needs re-running by hand. The function reads the organisation list through the `org_directory` session context (migration 002), which can read organisation rows and nothing else.

## Incidents

### The database is paused

The database is serverless and pauses after an hour without requests (`autoPauseDelay: 60`). The next request wakes it, which takes up to about a minute. Requests in that minute can answer 500 (in Application Insights: a login failure or SQL error 40613). Coaches see "Something went wrong" with a Retry button; anything they saved waits in the outbox and is resent. Public report links show "The report could not be loaded." until it is awake. Nothing needs doing: it is the cost of the free offer.

If it stays unavailable for more than five minutes:

1. Portal → `sqldb-stride-<env>-san` → Overview. "Paused" with the free allowance used up: see the next section.
2. "Online" but the API still fails: Function App → Log stream. Login failures for the managed identity mean the database user is missing or stale; a deploy re-creates it (the migrate step grants the API identity), so re-run the last deploy workflow.
3. Check the Azure status page for South Africa North.

### The free database allowance is used up

The free offer gives 100,000 vCore seconds a month. The `sql-free-allowance` alert fires below 20 percent. When it runs out, the database pauses until the first of the next month (`AutoPause`), and every signed-in screen fails. Analysis on the phone keeps working, and saves wait in the outbox.

Choose one:

- **Wait** for the reset on the first of the month. Tell the coaches; their saves send themselves once it is back.
- **Pay for the rest of the month.** Portal → `sqldb-stride-<env>-san` → Compute + storage → set the behaviour when the free limit is reached to "Continue using database for additional charges", or:

  ```bash
  az sql db update --resource-group rg-stride-prod-san --server sql-stride-prod-san \
    --name sqldb-stride-prod-san --free-limit-exhaustion-behavior BillOverUsage
  ```

  General Purpose serverless rates apply, under the resource-group budget alerts. `infra/deploy.sh` sets it back to `AutoPause`; to keep paying, change `freeLimitExhaustionBehavior` in `infra/modules/stride.bicep`.

Running out in a normal month means usage outgrew the free offer: see the upgrade path in the spec's cost guardrails.

### A coach is locked out

Ask what they see, and when it started.

| What they see                                                                                                                      | Cause                                                                              | Fix                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| No sign-in code arrives                                                                                                            | The email one-time passcode went to spam, or they typed another address            | Check spam; sign in with the exact address the invite went to. Entra admin centre (external tenant) → Users shows whether they have an account |
| "Not part of an organisation yet"                                                                                                  | Signed in with an address that has no coach record, or never accepted their invite | Their admin sends a new invite (Settings → Invite a coach) to the address they sign in with. An invite lasts 7 days and works once             |
| "Access removed"                                                                                                                   | An admin removed them                                                              | Their admin invites them again; accepting reactivates the same coach with their history                                                        |
| On the invite page: "This invite link is not valid, or it has expired", "already been used" or "sent to a different email address" | Expired, used, or opened with another account                                      | Sign in with the address the invite went to; otherwise their admin withdraws it and sends a new one                                            |
| The organisation's only admin left or lost their account                                                                           | No one can invite or remove                                                        | StatEdge invites a new admin, below                                                                                                            |

Invite a new admin to an existing organisation (the new invite needs a free seat; `--remove-email` removes the old admin first, which frees theirs):

```bash
export ENVIRONMENT=prod SQL_SERVER=sql-stride-prod-san.database.windows.net SQL_DATABASE=sqldb-stride-prod-san
pnpm invite-admin --org "Ridge High School" --email new.head@ridge.example \
  --remove-email old.head@ridge.example --web-origin https://stride.statedge.co.za
```

It prints the link once; send it to the new admin. Both steps appear in the organisation's audit log as done "by StatEdge". Confirm the request with the school or club through a contact you already know, never only the person asking, before giving anyone admin rights.

### A link must be revoked

A coach revokes their own links: the report → Share link → Revoke the link. The public copy is deleted at once, and the link then answers "This link is no longer available.", the same as an expired one.

When the coach cannot (a parent forwarded the link, the coach has left), StatEdge revokes it from the link alone:

```bash
export ENVIRONMENT=prod SQL_SERVER=sql-stride-prod-san.database.windows.net SQL_DATABASE=sqldb-stride-prod-san
pnpm revoke-link --url https://stride.statedge.co.za/r/<token>
```

It deletes the public copy and its frames and writes a `share.revoke` audit row "by StatEdge". The report itself stays with the organisation. Tell the organisation's admin. Never paste the link into a ticket or chat beyond what is needed: it is the only key to the copy until it is revoked.

### A data request

A request comes from the athlete, or a parent or guardian for a minor, usually through the coach or the school. The organisation is the responsible party for its athletes' data; StatEdge acts on its behalf, so the organisation's admin carries out the request in the app. Confirm who is asking through the organisation before anything is released or deleted, and respond within the time the privacy notice promises.

| Request                       | What the admin does                                                      | Notes                                                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| A copy of their data (access) | Athletes → the athlete → Download all data (JSON)                        | A JSON file of the athlete, consents, sessions, measurements and notes. Audited as `export.athlete`                                        |
| Stop using their data         | Athletes → the athlete → Consent → Withdraw                              | Blocks new analyses, saves and share links. Existing records stay until deletion is asked for                                              |
| Delete their data             | Athletes → the athlete → Delete athlete and all data, then type the name | Removes the athlete with consents, analyses, notes, reports and share links in one step. Audited as `athlete.delete` (ids and counts only) |
| Correct their details         | Athletes → the athlete → Edit                                            |                                                                                                                                            |

Video never reaches StatEdge: clips stay on the coach's phone. After a deletion, ask the coach to delete the clips from the phone too (the session screen, or the phone's own gallery); the app also removes local clips older than the organisation's retention period when it starts.

Data StatEdge holds outside an organisation: coach names and emails in the Entra external tenant, and backups. Point-in-time backups are kept for 7 days (the Azure default, no long-term retention is set), so deleted rows leave the backups within a week. Application Insights holds no personal data by design, and its logs expire after 30 days.

If an organisation asks StatEdge to do it instead (no admin left), invite a new admin first ("A coach is locked out"), so that the request is carried out and audited inside the organisation.
