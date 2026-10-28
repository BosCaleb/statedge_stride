# Stride infrastructure (Terraform)

This module belongs in the `statedge-infra` repository as the `stride` module, with its own state file per environment. It is kept here until it is moved there, because this session had no access to that repository. Move `modules/stride` and `environments/*` across unchanged.

Everything is in South Africa North except the Static Web App, which is not offered there. It is created in West Europe and serves static files only.

## What it creates (per environment)

| Resource                               | Name                                             | Notes                                                                                                                         |
| -------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Resource group                         | `rg-stride-<env>-san`                            | Tagged with environment and owner                                                                                             |
| Static Web App                         | `stapp-stride-<env>-weu`                         | Free plan. Custom domain in a second phase                                                                                    |
| Storage account                        | `ststride<env>san`                               | Standard LRS, TLS 1.2, required by Functions                                                                                  |
| Function App                           | `func-stride-<env>-san`                          | Linux Consumption (Y1), Node 22, system-assigned identity, HTTPS only, TLS 1.2, FTP and basic publishing off                  |
| SQL server and database                | `sql-stride-<env>-san`, `sqldb-stride-<env>-san` | Entra-only authentication, serverless General Purpose with the free offer, firewall rule for Azure services                   |
| Log Analytics and Application Insights | `log-…`, `appi-…`                                | Workspace-based, 30-day retention, 0.1 GB daily cap                                                                           |
| Budget and alerts                      | `budget-…`, `ag-…`, `alert-…`                    | US$15 budget at 50, 80 and 100 percent; 5xx, failures, executions, free SQL compute, log cap                                  |
| Deploy identity                        | `id-stride-<env>-san-deploy`                     | Federated credential for the GitHub environment; Website Contributor on the Function App; SQL administrator (runs migrations) |
| GitHub environment                     | `dev` or `prod`                                  | Variables for the deploy workflow, the Static Web App deployment token as the only secret, reviewers for prod                 |

The Function App's platform CORS setting is left empty on purpose: the API applies `ALLOWED_ORIGINS` itself, so local and cloud behave the same and the headers are not duplicated.

## Order of operations for a new environment

You need: Owner on the subscription (to create role assignments), an Azure CLI sign-in, and a GitHub token of a repository administrator in `GITHUB_TOKEN`. The Entra External ID tenant and its app registrations come first (see `docs/runbook.md`), because the API audience is an input.

1. Copy `environments/<env>/backend.hcl.example` to `backend.hcl` and `terraform.tfvars.example` to `terraform.tfvars`, and fill them in. Then `terraform init -backend-config=backend.hcl`.
2. Create everything the database depends on:

   ```bash
   terraform apply -target=module.stride.azurerm_mssql_server.main
   ```

3. Create the database with the free offer. The azurerm provider has no free-offer arguments, so this one resource starts in the CLI:

   ```bash
   az sql db create --resource-group rg-stride-dev-san --server sql-stride-dev-san \
     --name sqldb-stride-dev-san --edition GeneralPurpose --compute-model Serverless \
     --family Gen5 --capacity 2 --min-capacity 0.5 --auto-pause-delay 60 \
     --backup-storage-redundancy Local --use-free-limit --free-limit-exhaustion-behavior AutoPause
   ```

4. Set `database_created = true` in `terraform.tfvars` and run `terraform apply`. The import block adopts the database and the rest is created.
5. Fill in `apps/web/.env.<env>` in the application repository: `VITE_API_BASE_URL` (output `api_url`), the tenant subdomain, the SPA client id, the API scope and the Application Insights connection string (`terraform output -raw application_insights_connection_string`). The deploy workflow refuses to run while any `REPLACE_ME` remains.
6. Push to `dev` (or `main` for prod). The workflow runs the migrations, which also create the database user for the Function App's managed identity with `db_datareader`, `db_datawriter` and `EXECUTE` on the `stride` schema, never `db_owner`.

## Custom domain, in two phases

The custom domain resource fails until DNS exists, so:

1. Apply with `custom_domain = "stride.statedge.co.za"` and `custom_domain_dns_ready = false`.
2. At GoDaddy, add a CNAME from `stride` to the `web_hostname` output.
3. Set `custom_domain_dns_ready = true` and apply again. `ALLOWED_ORIGINS` and the `WEB_URL` variable then include the custom domain.

The API keeps the default `azurewebsites.net` hostname for the MVP.

## Known and accepted risks

- The SQL firewall allows Azure services, because the Consumption plan has no fixed outbound addresses. This also admits other Azure tenants' resources at the network level; authentication is Entra-only. Revisit when the plan or tier changes.
- `AzureWebJobsStorage` uses the storage account key, as the Consumption plan's run-from-package deployment expects. The key lives only in Azure.
- Deleted data can persist in Azure SQL backups until the backup retention period ends. State this in the privacy notice.
- Microsoft has announced the retirement of the Linux Consumption plan in favour of Flex Consumption. Check that Y1 is still offered in South Africa North when provisioning; moving to Flex Consumption changes only the plan and Function App resources.
