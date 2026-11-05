terraform {
  required_providers {
    pertisk = {
      source = "pertisktech/pertisk-gits"
    }
  }
}

provider "pertisk" {
  base_url = var.base_url
  token    = var.token
  insecure = var.insecure
}

variable "base_url" {
  type    = string
  default = "http://127.0.0.1:3000"
}

variable "token" {
  type      = string
  sensitive = true
}

variable "insecure" {
  type    = bool
  default = false
}

variable "deploy_token" {
  type      = string
  sensitive = true
  default   = "change-me"
}

variable "sonar_token" {
  type      = string
  sensitive = true
  default   = "change-me"
}

resource "pertisk_gits_group" "platform" {
  slug = "platform"
  name = "Platform"
}

resource "pertisk_gits_project" "app" {
  org_path   = pertisk_gits_group.platform.full_path
  slug       = "app"
  name       = "App"
  visibility = "private"
}

# --- Automation: CI variables (vars.NAME) ---

resource "pertisk_gits_ci_variable" "server_registry" {
  scope       = "server"
  name        = "HARBOR_REGISTRY"
  environment = "all"
  value       = "harbor.example.com"
}

resource "pertisk_gits_ci_variable" "group_sonar_url" {
  scope       = "group"
  org_path    = pertisk_gits_group.platform.full_path
  name        = "SONAR_DASHBOARD_URL"
  environment = "all"
  value       = "https://sonar.example.com/dashboard"
}

resource "pertisk_gits_ci_variable" "repo_service_name" {
  scope       = "repository"
  org_path    = pertisk_gits_group.platform.full_path
  repo_slug   = pertisk_gits_project.app.slug
  name        = "SERVICE_NAME"
  environment = "all"
  value       = "app"
}

# --- Automation: CI secrets (secrets.NAME) ---

resource "pertisk_gits_ci_secret" "server_ci_bot" {
  scope       = "server"
  name        = "CI_BOT_TOKEN"
  environment = "all"
  value       = var.deploy_token
}

resource "pertisk_gits_ci_secret" "group_sonar" {
  scope       = "group"
  org_path    = pertisk_gits_group.platform.full_path
  name        = "SONAR_TOKEN"
  environment = "all"
  value       = var.sonar_token
}

resource "pertisk_gits_ci_secret" "repo_deploy" {
  scope       = "repository"
  org_path    = pertisk_gits_group.platform.full_path
  repo_slug   = pertisk_gits_project.app.slug
  name        = "DEPLOY_TOKEN"
  environment = "prd"
  value       = var.deploy_token
}
