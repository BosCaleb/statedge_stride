# Cost guardrails and alerts. Everything emails the founder through one action group.

resource "azurerm_monitor_action_group" "founder" {
  name                = "ag-${local.suffix}"
  resource_group_name = azurerm_resource_group.main.name
  short_name          = "stride${var.environment}"
  tags                = local.tags

  email_receiver {
    name                    = "founder"
    email_address           = var.alert_email
    use_common_alert_schema = true
  }
}

resource "azurerm_consumption_budget_resource_group" "main" {
  name              = "budget-${local.suffix}"
  resource_group_id = azurerm_resource_group.main.id
  amount            = var.monthly_budget_usd
  time_grain        = "Monthly"

  time_period {
    start_date = var.budget_start_date
  }

  dynamic "notification" {
    for_each = [50, 80, 100]
    content {
      enabled        = true
      threshold      = notification.value
      operator       = "GreaterThanOrEqualTo"
      threshold_type = "Actual"
      contact_emails = [var.alert_email]
      contact_groups = [azurerm_monitor_action_group.founder.id]
    }
  }
}

resource "azurerm_monitor_metric_alert" "http_5xx" {
  name                = "alert-${local.suffix}-5xx"
  resource_group_name = azurerm_resource_group.main.name
  scopes              = [azurerm_linux_function_app.api.id]
  description         = "The API answered with server errors."
  severity            = 2
  frequency           = "PT5M"
  window_size         = "PT15M"
  tags                = local.tags

  criteria {
    metric_namespace = "Microsoft.Web/sites"
    metric_name      = "Http5xx"
    aggregation      = "Total"
    operator         = "GreaterThan"
    threshold        = 5
  }

  action {
    action_group_id = azurerm_monitor_action_group.founder.id
  }
}

resource "azurerm_monitor_metric_alert" "failed_requests" {
  name                = "alert-${local.suffix}-function-failures"
  resource_group_name = azurerm_resource_group.main.name
  scopes              = [azurerm_application_insights.main.id]
  description         = "Function invocations are failing."
  severity            = 2
  frequency           = "PT5M"
  window_size         = "PT15M"
  tags                = local.tags

  criteria {
    metric_namespace = "microsoft.insights/components"
    metric_name      = "requests/failed"
    aggregation      = "Count"
    operator         = "GreaterThan"
    threshold        = 5
  }

  action {
    action_group_id = azurerm_monitor_action_group.founder.id
  }
}

resource "azurerm_monitor_metric_alert" "executions" {
  name                = "alert-${local.suffix}-executions"
  resource_group_name = azurerm_resource_group.main.name
  scopes              = [azurerm_linux_function_app.api.id]
  description         = "Daily executions are approaching the free monthly grant."
  severity            = 3
  frequency           = "PT1H"
  window_size         = "P1D"
  tags                = local.tags

  criteria {
    metric_namespace = "Microsoft.Web/sites"
    metric_name      = "FunctionExecutionCount"
    aggregation      = "Total"
    operator         = "GreaterThan"
    threshold        = var.function_executions_per_day_alert
  }

  action {
    action_group_id = azurerm_monitor_action_group.founder.id
  }
}

# The free offer grants 100,000 vCore seconds a month. Warn below 20 percent, then choose
# between pausing until the next month and paid serverless.
resource "azurerm_monitor_metric_alert" "sql_free_allowance" {
  name                = "alert-${local.suffix}-sql-free-allowance"
  resource_group_name = azurerm_resource_group.main.name
  scopes              = [azurerm_mssql_database.main.id]
  description         = "Less than 20 percent of the free database compute remains this month."
  severity            = 2
  frequency           = "PT1H"
  window_size         = "PT1H"
  tags                = local.tags

  criteria {
    metric_namespace = "Microsoft.Sql/servers/databases"
    metric_name      = "free_amount_remaining"
    aggregation      = "Minimum"
    operator         = "LessThan"
    threshold        = 20000
  }

  action {
    action_group_id = azurerm_monitor_action_group.founder.id
  }
}

# The Log Analytics daily cap was reached: ingestion stops until the next day.
resource "azurerm_monitor_scheduled_query_rules_alert_v2" "log_cap" {
  name                 = "alert-${local.suffix}-log-cap"
  resource_group_name  = azurerm_resource_group.main.name
  location             = var.location
  scopes               = [azurerm_log_analytics_workspace.main.id]
  description          = "The daily ingestion cap was reached."
  severity             = 3
  evaluation_frequency = "P1D"
  window_duration      = "P1D"
  tags                 = local.tags

  criteria {
    query                   = <<-KQL
      _LogOperation
      | where Category == "Ingestion" and Operation has "Data collection stopped"
    KQL
    time_aggregation_method = "Count"
    operator                = "GreaterThan"
    threshold               = 0
  }

  action {
    action_groups = [azurerm_monitor_action_group.founder.id]
  }
}
