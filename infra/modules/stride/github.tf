# The GitHub environment the deploy workflow runs in: its variables (none of them secret) and
# the Static Web App deployment token, the one secret the platform requires. Production deploys
# wait for a reviewer.

locals {
  repository_name = split("/", var.github_repository)[1]
  github_variables = {
    AZURE_CLIENT_ID       = azurerm_user_assigned_identity.deploy.client_id
    AZURE_TENANT_ID       = data.azurerm_client_config.current.tenant_id
    AZURE_SUBSCRIPTION_ID = data.azurerm_client_config.current.subscription_id
    RESOURCE_GROUP        = azurerm_resource_group.main.name
    FUNCTION_APP_NAME     = azurerm_linux_function_app.api.name
    API_URL               = "https://${azurerm_linux_function_app.api.default_hostname}/api"
    WEB_URL               = var.custom_domain != null && var.custom_domain_dns_ready ? "https://${var.custom_domain}" : "https://${azurerm_static_web_app.web.default_host_name}"
    SQL_SERVER            = azurerm_mssql_server.main.fully_qualified_domain_name
    SQL_DATABASE          = local.database_name
    SQL_STAFF_USERS       = join(",", var.sql_staff_users)
  }
}

resource "github_repository_environment" "main" {
  repository  = local.repository_name
  environment = var.environment

  dynamic "reviewers" {
    for_each = var.environment == "prod" && length(var.github_reviewer_user_ids) > 0 ? [1] : []
    content {
      users = var.github_reviewer_user_ids
    }
  }

  deployment_branch_policy {
    protected_branches     = false
    custom_branch_policies = true
  }
}

resource "github_repository_environment_deployment_policy" "branch" {
  repository     = local.repository_name
  environment    = github_repository_environment.main.environment
  branch_pattern = var.environment == "prod" ? "main" : "dev"
}

resource "github_actions_environment_variable" "main" {
  for_each      = local.github_variables
  repository    = local.repository_name
  environment   = github_repository_environment.main.environment
  variable_name = each.key
  value         = each.value
}

resource "github_actions_environment_secret" "swa_token" {
  repository      = local.repository_name
  environment     = github_repository_environment.main.environment
  secret_name     = "AZURE_STATIC_WEB_APPS_API_TOKEN"
  plaintext_value = azurerm_static_web_app.web.api_key
}
