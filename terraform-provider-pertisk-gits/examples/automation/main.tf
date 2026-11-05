# Manage Automation CI secrets/variables at every level
# (Admin → Automation, Group → Settings → Automation, Project → Settings → Automation).
#
# Job merge order: predefined → server → group → repository
# Pipeline refs: ${{ vars.NAME }} / ${{ secrets.NAME }}

terraform {
  required_providers {
    pertisk = {
      source = "pertisktech/pertisk-gits"
    }
  }
}

provider "pertisk" {
  base_url = var.base_url
  token    = var.token # server scope needs super-admin
  insecure = var.insecure
}

variable "base_url" {
  type = string
}

variable "token" {
  type      = string
  sensitive = true
}

variable "insecure" {
  type    = bool
  default = false
}

variable "org_path" {
  type        = string
  description = "Existing group full path (e.g. platform)."
}

variable "repo_slug" {
  type        = string
  description = "Existing repository slug under org_path."
}

variable "harbor_password" {
  type      = string
  sensitive = true
}

# Server (Admin → Automation)
resource "pertisk_gits_ci_variable" "server_harbor_host" {
  scope       = "server"
  name        = "HARBOR_REGISTRY"
  environment = "all"
  value       = "harbor.example.com"
}

resource "pertisk_gits_ci_secret" "server_harbor_password" {
  scope       = "server"
  name        = "HARBOR_PASSWORD"
  environment = "all"
  masked      = true
  value       = var.harbor_password
}

# Group (Group → Settings → Automation)
resource "pertisk_gits_ci_variable" "group_registry_project" {
  scope       = "group"
  org_path    = var.org_path
  name        = "HARBOR_PROJECT"
  environment = "all"
  value       = "platform"
}

resource "pertisk_gits_ci_secret" "group_deploy_key" {
  scope       = "group"
  org_path    = var.org_path
  name        = "DEPLOY_SSH_KEY"
  environment = "prd"
  secret_kind = "file"
  value       = file("${path.module}/deploy.key")
}

# Repository (Project → Settings → Automation)
resource "pertisk_gits_ci_variable" "repo_image_name" {
  scope       = "repository"
  org_path    = var.org_path
  repo_slug   = var.repo_slug
  name        = "IMAGE_NAME"
  environment = "all"
  value       = var.repo_slug
}

resource "pertisk_gits_ci_secret" "repo_env_token" {
  scope       = "repository"
  org_path    = var.org_path
  repo_slug   = var.repo_slug
  name        = "DEPLOY_TOKEN"
  environment = "prd"
  value       = var.harbor_password
}

# Per-environment overrides (same name, different env)
resource "pertisk_gits_ci_variable" "repo_harbor_dev" {
  scope       = "repository"
  org_path    = var.org_path
  repo_slug   = var.repo_slug
  name        = "HARBOR_REGISTRY"
  environment = "dev"
  value       = "harbor-dev.example.com"
}

resource "pertisk_gits_ci_variable" "repo_harbor_prd" {
  scope       = "repository"
  org_path    = var.org_path
  repo_slug   = var.repo_slug
  name        = "HARBOR_REGISTRY"
  environment = "prd"
  value       = "harbor.example.com"
}
