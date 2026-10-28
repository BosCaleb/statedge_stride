variable "environment" {
  description = "dev or prod."
  type        = string
  validation {
    condition     = contains(["dev", "prod"], var.environment)
    error_message = "environment must be dev or prod."
  }
}

variable "location" {
  description = "Region for everything except the Static Web App."
  type        = string
  default     = "southafricanorth"
}

variable "location_short" {
  description = "Region code in resource names."
  type        = string
  default     = "san"
}

variable "static_web_app_location" {
  description = "Static Web Apps is not offered in South Africa North. It serves static files only."
  type        = string
  default     = "westeurope"
}

variable "owner" {
  description = "Owner tag, and who budget and alert emails go to."
  type        = string
}

variable "alert_email" {
  description = "Email address for the action group (the founder)."
  type        = string
}

variable "monthly_budget_usd" {
  description = "Resource-group budget, with notifications at 50, 80 and 100 percent."
  type        = number
  default     = 15
}

variable "budget_start_date" {
  description = "First day of the first budget month, as YYYY-MM-01T00:00:00Z (must not be in the past when created)."
  type        = string
}

variable "entra_tenant_id" {
  description = "The External ID (customer) tenant that signs coaches in."
  type        = string
}

variable "entra_api_client_id" {
  description = "Client id of the stride-api app registration: the audience of access tokens."
  type        = string
}

variable "github_repository" {
  description = "owner/name of the application repository."
  type        = string
  default     = "BosCaleb/statedge_stride"
}

variable "github_reviewer_user_ids" {
  description = "GitHub user ids who approve production deploys (prod only)."
  type        = list(number)
  default     = []
}

variable "sql_staff_users" {
  description = "Entra users (UPNs) of StatEdge staff who run the staff scripts against this database."
  type        = list(string)
  default     = []
}

variable "custom_domain" {
  description = "Custom hostname for the web app, such as stride.statedge.co.za. Null for none."
  type        = string
  default     = null
}

variable "custom_domain_dns_ready" {
  description = "Phase two of the custom domain: set true once the CNAME at the DNS host points at the Static Web App."
  type        = bool
  default     = false
}

variable "log_daily_cap_gb" {
  description = "Daily ingestion cap for Log Analytics and Application Insights."
  type        = number
  default     = 0.1
}

variable "function_executions_per_day_alert" {
  description = "Alert when daily executions pass this (the free grant is about 33,000 a day)."
  type        = number
  default     = 25000
}

variable "tags" {
  description = "Extra tags."
  type        = map(string)
  default     = {}
}
