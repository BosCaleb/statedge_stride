output "web_hostname" {
  description = "Default hostname of the Static Web App. Point the custom domain's CNAME here."
  value       = azurerm_static_web_app.web.default_host_name
}

output "api_url" {
  description = "Base URL of the API, for VITE_API_BASE_URL."
  value       = "https://${azurerm_linux_function_app.api.default_hostname}/api"
}

output "function_app_name" {
  value = azurerm_linux_function_app.api.name
}

output "sql_server" {
  value = azurerm_mssql_server.main.fully_qualified_domain_name
}

output "sql_database" {
  value = local.database_name
}

output "application_insights_connection_string" {
  description = "Public ingestion settings for APPLICATIONINSIGHTS_CONNECTION_STRING in the web build."
  value       = azurerm_application_insights.main.connection_string
  sensitive   = true
}

output "deploy_identity_client_id" {
  value = azurerm_user_assigned_identity.deploy.client_id
}
