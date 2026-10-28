# The Stride dev environment. State lives in the statedge-infra state storage account,
# configured with -backend-config=backend.hcl (see backend.hcl.example and infra/README.md).

terraform {
  required_version = ">= 1.7.0"
  backend "azurerm" {}

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
    github = {
      source  = "integrations/github"
      version = "~> 6.0"
    }
  }
}

provider "azurerm" {
  features {}
  subscription_id = var.subscription_id
}

# Uses GITHUB_TOKEN from the environment: a token of a repository administrator.
provider "github" {
  owner = split("/", var.github_repository)[0]
}

module "stride" {
  source = "../../modules/stride"

  environment              = "dev"
  owner                    = var.owner
  alert_email              = var.alert_email
  budget_start_date        = var.budget_start_date
  entra_tenant_id          = var.entra_tenant_id
  entra_api_client_id      = var.entra_api_client_id
  github_repository        = var.github_repository
  github_reviewer_user_ids = var.github_reviewer_user_ids
  sql_staff_users          = var.sql_staff_users
  custom_domain            = var.custom_domain
  custom_domain_dns_ready  = var.custom_domain_dns_ready
}

# The free-offer database is created once with the Azure CLI (infra/README.md, step 3), then
# adopted here: set database_created = true after that step.
import {
  for_each = var.database_created ? toset(["sqldb-stride-dev-san"]) : toset([])
  to       = module.stride.azurerm_mssql_database.main
  id       = "/subscriptions/${var.subscription_id}/resourceGroups/rg-stride-dev-san/providers/Microsoft.Sql/servers/sql-stride-dev-san/databases/${each.value}"
}

variable "subscription_id" {
  type = string
}

variable "owner" {
  type = string
}

variable "alert_email" {
  type = string
}

variable "budget_start_date" {
  type = string
}

variable "entra_tenant_id" {
  type = string
}

variable "entra_api_client_id" {
  type = string
}

variable "github_repository" {
  type    = string
  default = "BosCaleb/statedge_stride"
}

variable "github_reviewer_user_ids" {
  type    = list(number)
  default = []
}

variable "sql_staff_users" {
  type    = list(string)
  default = []
}

variable "custom_domain" {
  type    = string
  default = null
}

variable "custom_domain_dns_ready" {
  type    = bool
  default = false
}

variable "database_created" {
  description = "True once the free-offer database exists (created with the Azure CLI)."
  type        = bool
  default     = false
}

output "web_hostname" {
  value = module.stride.web_hostname
}

output "api_url" {
  value = module.stride.api_url
}
