# Stride infrastructure (Bicep)

One Bicep deployment per environment creates everything in Azure. The deploy script then points the GitHub environment at it. There is no state file: Azure is the record of what exists, and running the script again converges on the same result.

Everything is in South Africa North except the Static Web App, which is not offered there. It is created in West Europe and serves static files only.

| File                            | What it is                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `main.bicep`                    | Subscription scope: the resource group, the custom role for the pipeline, and the module               |
| `modules/stride.bicep`          | Everything in the resource group                                                                       |
| `modules/appSettings.bicep`     | Writes the Function App settings and keeps the ones a code deployment set (`WEBSITE_RUN_FROM_PACKAGE`) |
| `environments/<env>.bicepparam` | The settings of each environment. None is a secret                                                     |
| `deploy.sh`                     | Deploys an environment (or shows a what-if), then configures its GitHub environment                    |
| `bicepconfig.json`              | Linter rules. CI builds every template and parameter file and fails on any warning                     |

## What it creates (per environment)

| Resource                               | Name                                             | Notes                                                                                                                                                         |
| -------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Resource group                         | `rg-stride-<env>-san`                            | Tagged with environment and owner                                                                                                                             |
| Static Web App                         | `stapp-stride-<env>-weu`                         | Free plan. Custom domain in a second phase                                                                                                                    |
| Storage account                        | `ststride<env>san`                               | Standard LRS, TLS 1.2, required by Functions                                                                                                                  |
| Function App                           | `func-stride-<env>-san`                          | Linux Consumption (Y1), Node 22, HTTPS only, TLS 1.2, FTP and basic publishing off                                                                            |
| API identity                           | `id-stride-<env>-san-api`                        | User-assigned. The API signs in to Azure SQL with it (`SQL_CLIENT_ID`)                                                                                        |
| SQL server and database                | `sql-stride-<env>-san`, `sqldb-stride-<env>-san` | Entra-only authentication, serverless General Purpose with the free offer (`useFreeLimit`, pause when used up), firewall rule for Azure services, delete lock |
| Log Analytics and Application Insights | `log-…`, `appi-…`                                | Workspace-based, 30-day retention, 0.1 GB daily cap                                                                                                           |
| Budget and alerts                      | `budget-…`, `ag-…`, `alert-…`                    | US$15 budget at 50, 80 and 100 percent; 5xx, failures, executions, free SQL compute, log cap                                                                  |
| Deploy identity                        | `id-stride-<env>-san-deploy`                     | Federated credential for the GitHub environment; SQL administrator (runs migrations); Website Contributor on the Function App; reads the Static Web App token |
| Custom role                            | `Stride <env> static web app token reader`       | Read and `listSecrets` on that one Static Web App, nothing more                                                                                               |

`deploy.sh` then sets up the repository's GitHub environment of the same name: deployments only from `dev` (or `main` for prod), the reviewers listed for prod, and the variables the deploy workflow reads. There is no GitHub secret: the workflow signs in with OIDC and reads the Static Web App deployment token at deploy time. Required reviewers on a private repository need a paid GitHub plan.

The Function App's platform CORS setting is left empty on purpose: the API applies `ALLOWED_ORIGINS` itself, so local and cloud behave the same and the headers are not duplicated.

## Deploying an environment

You need the Azure CLI signed in as an Owner of the subscription (the templates create a custom role, role assignments and a lock), the GitHub CLI signed in as an administrator of the repository, and `jq`. The Entra External ID tenant and its app registrations come first (see `docs/runbook.md`), because the API audience is a setting.

1. Fill in `environments/<env>.bicepparam`: owner, alert email, the External ID tenant id, the `stride-api` client id, and the staff who run staff scripts, with their Entra object ids (`az ad user show --id <upn> --query id`). Commit it; none of it is secret.
2. See what would change, then deploy:

   ```bash
   infra/deploy.sh dev --what-if
   ```

   ```bash
   infra/deploy.sh dev
   ```

3. Fill in `apps/web/.env.<env>` from what the script prints: `VITE_API_BASE_URL` and `APPLICATIONINSIGHTS_CONNECTION_STRING`, plus the tenant subdomain, the SPA client id and the API scope. The deploy workflow refuses to run while any `REPLACE_ME` remains.
4. Push to `dev` (or `main` for prod). The workflow runs the migrations, which create the database user for the API identity from its client id, with `db_datareader`, `db_datawriter` and `EXECUTE` on the `stride` schema, never `db_owner`. Staff in `sqlStaffUsers` get the same rights.

Run `infra/deploy.sh <env>` again after any change to the templates or settings. App settings that a code deployment added are kept.

## Custom domain, in two phases

The custom domain resource fails until DNS exists, so:

1. Deploy with `customDomain = 'stride.statedge.co.za'` and `customDomainDnsReady = false`.
2. At GoDaddy, add a CNAME from `stride` to the web hostname the script prints.
3. Set `customDomainDnsReady = true` and deploy again. `WEB_URL` then points at the custom domain; `ALLOWED_ORIGINS` includes it from the first phase.

The API keeps the default `azurewebsites.net` hostname for the MVP.

## Known and accepted risks

- The SQL firewall allows Azure services, because the Consumption plan has no fixed outbound addresses. This also admits other Azure tenants' resources at the network level; authentication is Entra-only. Revisit when the plan or tier changes.
- `AzureWebJobsStorage` uses the storage account key, as the Consumption plan's run-from-package deployment expects. The key lives only in Azure; the template passes it through a secure parameter, so it is not kept in the deployment history.
- Deleted data can persist in Azure SQL backups until the backup retention period ends. State this in the privacy notice.
- Microsoft has announced the retirement of the Linux Consumption plan in favour of Flex Consumption. Check that Y1 is still offered in South Africa North when provisioning; moving to Flex Consumption changes only the plan and Function App resources.
- The templates are built and linted in CI but have not yet been deployed. Run the what-if first, and check the first dev deployment end to end.
