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

resource "pertisk_gits_ci_variable" "registry" {
  scope       = "server"
  name        = "HARBOR_REGISTRY"
  environment = "all"
  value       = "harbor.example.com"
}

resource "pertisk_gits_ci_secret" "deploy_token" {
  scope       = "repository"
  org_path    = pertisk_gits_group.platform.full_path
  repo_slug   = pertisk_gits_project.app.slug
  name        = "DEPLOY_TOKEN"
  environment = "prd"
  value       = var.deploy_token
}
