# The Stride environment: static web app, Function App on the Consumption plan, Azure SQL free
# offer, monitoring with low caps, and the GitHub OIDC identity that deploys it all.
# Names follow <type>-stride-<env>-<region>.

locals {
  suffix = "stride-${var.environment}-${var.location_short}"
  tags = merge(var.tags, {
    environment = var.environment
    owner       = var.owner
    application = "stride"
  })
  web_origins = compact([
    "https://${azurerm_static_web_app.web.default_host_name}",
    var.custom_domain == null ? null : "https://${var.custom_domain}",
  ])
}

data "azurerm_client_config" "current" {}

resource "azurerm_resource_group" "main" {
  name     = "rg-${local.suffix}"
  location = var.location
  tags     = local.tags
}

# --- Web -------------------------------------------------------------------------------------

resource "azurerm_static_web_app" "web" {
  name                = "stapp-stride-${var.environment}-weu"
  resource_group_name = azurerm_resource_group.main.name
  location            = var.static_web_app_location
  sku_tier            = "Free"
  sku_size            = "Free"
  tags                = local.tags
}

# Phase two of the custom domain: apply once the CNAME exists, otherwise validation fails.
resource "azurerm_static_web_app_custom_domain" "web" {
  count             = var.custom_domain != null && var.custom_domain_dns_ready ? 1 : 0
  static_web_app_id = azurerm_static_web_app.web.id
  domain_name       = var.custom_domain
  validation_type   = "cname-delegation"
}

# --- API -------------------------------------------------------------------------------------

resource "azurerm_storage_account" "functions" {
  name                            = "ststride${var.environment}${var.location_short}"
  resource_group_name             = azurerm_resource_group.main.name
  location                        = var.location
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  min_tls_version                 = "TLS1_2"
  https_traffic_only_enabled      = true
  allow_nested_items_to_be_public = false
  tags                            = local.tags
}

resource "azurerm_service_plan" "functions" {
  name                = "asp-${local.suffix}"
  resource_group_name = azurerm_resource_group.main.name
  location            = var.location
  os_type             = "Linux"
  sku_name            = "Y1"
  tags                = local.tags
}

resource "azurerm_linux_function_app" "api" {
  name                                           = "func-${local.suffix}"
  resource_group_name                            = azurerm_resource_group.main.name
  location                                       = var.location
  service_plan_id                                = azurerm_service_plan.functions.id
  storage_account_name                           = azurerm_storage_account.functions.name
  storage_account_access_key                     = azurerm_storage_account.functions.primary_access_key
  https_only                                     = true
  ftp_publish_basic_authentication_enabled       = false
  webdeploy_publish_basic_authentication_enabled = false
  tags                                           = local.tags

  identity {
    type = "SystemAssigned"
  }

  site_config {
    minimum_tls_version                    = "1.2"
    ftps_state                             = "Disabled"
    http2_enabled                          = true
    application_insights_connection_string = azurerm_application_insights.main.connection_string
    application_stack {
      node_version = "22"
    }
    # CORS is handled by the API itself (ALLOWED_ORIGINS), so that errors and preflights carry
    # the same headers in every environment. Platform CORS stays empty: both would duplicate
    # the Access-Control-Allow-Origin header.
  }

  app_settings = {
    ENVIRONMENT        = var.environment
    SQL_SERVER         = azurerm_mssql_server.main.fully_qualified_domain_name
    SQL_DATABASE       = local.database_name
    SQL_AUTH           = "entra"
    ENTRA_TENANT_ID    = var.entra_tenant_id
    ENTRA_API_AUDIENCE = var.entra_api_client_id
    ALLOWED_ORIGINS    = join(",", local.web_origins)
  }

  lifecycle {
    # Set by each deployment (run from package).
    ignore_changes = [app_settings["WEBSITE_RUN_FROM_PACKAGE"], tags["hidden-link: /app-insights-resource-id"]]
  }
}

# --- Database --------------------------------------------------------------------------------

locals {
  database_name = "sqldb-${local.suffix}"
}

resource "azurerm_mssql_server" "main" {
  name                          = "sql-${local.suffix}"
  resource_group_name           = azurerm_resource_group.main.name
  location                      = var.location
  version                       = "12.0"
  minimum_tls_version           = "1.2"
  public_network_access_enabled = true
  tags                          = local.tags

  # Entra-only authentication. The deploy identity is the administrator, so that migrations
  # run in the pipeline; the API's managed identity gets least-privilege rights from them.
  azuread_administrator {
    login_username              = azurerm_user_assigned_identity.deploy.name
    object_id                   = azurerm_user_assigned_identity.deploy.principal_id
    tenant_id                   = data.azurerm_client_config.current.tenant_id
    azuread_authentication_only = true
  }
}

# The Consumption plan has no fixed outbound addresses, so Azure services are allowed. A known
# and accepted risk for the MVP (see docs/decisions.md).
resource "azurerm_mssql_firewall_rule" "azure_services" {
  name             = "AllowAzureServices"
  server_id        = azurerm_mssql_server.main.id
  start_ip_address = "0.0.0.0"
  end_ip_address   = "0.0.0.0"
}

# Created once with the free-offer settings by the Azure CLI (see infra/README.md), because the
# provider has no free-offer arguments, then imported into state by the environment's import
# block. Terraform keeps the serverless settings; the free-limit flags are left as created.
resource "azurerm_mssql_database" "main" {
  name                        = local.database_name
  server_id                   = azurerm_mssql_server.main.id
  sku_name                    = "GP_S_Gen5_2"
  min_capacity                = 0.5
  auto_pause_delay_in_minutes = 60
  max_size_gb                 = 32
  zone_redundant              = false
  storage_account_type        = "Local"
  tags                        = local.tags

  lifecycle {
    prevent_destroy = true
  }
}

# --- Monitoring ------------------------------------------------------------------------------

resource "azurerm_log_analytics_workspace" "main" {
  name                = "log-${local.suffix}"
  resource_group_name = azurerm_resource_group.main.name
  location            = var.location
  sku                 = "PerGB2018"
  retention_in_days   = 30
  daily_quota_gb      = var.log_daily_cap_gb
  tags                = local.tags
}

resource "azurerm_application_insights" "main" {
  name                 = "appi-${local.suffix}"
  resource_group_name  = azurerm_resource_group.main.name
  location             = var.location
  workspace_id         = azurerm_log_analytics_workspace.main.id
  application_type     = "web"
  daily_data_cap_in_gb = var.log_daily_cap_gb
  retention_in_days    = 30
  tags                 = local.tags
}

# --- Deployment identity (GitHub OIDC) -------------------------------------------------------

resource "azurerm_user_assigned_identity" "deploy" {
  name                = "id-${local.suffix}-deploy"
  resource_group_name = azurerm_resource_group.main.name
  location            = var.location
  tags                = local.tags
}

resource "azurerm_federated_identity_credential" "github" {
  name                = "github-${var.environment}"
  resource_group_name = azurerm_resource_group.main.name
  parent_id           = azurerm_user_assigned_identity.deploy.id
  issuer              = "https://token.actions.githubusercontent.com"
  audience            = ["api://AzureADTokenExchange"]
  subject             = "repo:${var.github_repository}:environment:${var.environment}"
}

# Least privilege: deploy to (and read the settings of) the Function App, nothing more. The
# Static Web App is deployed with its deployment token, held as a GitHub environment secret.
resource "azurerm_role_assignment" "deploy_function_app" {
  scope                = azurerm_linux_function_app.api.id
  role_definition_name = "Website Contributor"
  principal_id         = azurerm_user_assigned_identity.deploy.principal_id
}
