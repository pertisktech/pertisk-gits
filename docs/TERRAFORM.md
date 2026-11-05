# Terraform / OpenTofu provider

Manage Pertisk Gits groups, projects, and CI variables/secrets with Terraform or OpenTofu.

Provider source: `pertisktech/pertisk-gits` (local install until published to the registry).

## Install

```bash
cd terraform-provider-pertisk-gits
make install
```

This builds `bin/terraform-provider-pertisk-gits` and copies it to
`~/.terraform.d/plugins/registry.terraform.io/pertisktech/pertisk-gits/<version>/<os>_<arch>/`.

Optional `~/.terraformrc` for development:

```hcl
provider_installation {
  dev_overrides {
    "pertisktech/pertisk-gits" = "/absolute/path/to/pertisk-gits/terraform-provider-pertisk-gits"
  }
  direct {}
}
```

## Auth

Use an API token (machine user or personal) or a JWT from login:

```hcl
provider "pertisk" {
  base_url = "https://git.example.com"
  token    = var.pertisk_token
  # insecure = true  # self-signed TLS
}
```

Environment fallbacks: `PERTISK_GITS_URL` / `PERTISK_URL`, `PERTISK_GITS_TOKEN` / `PERTISK_TOKEN`, `PERTISK_TLS_INSECURE`.

Server-scoped CI resources require a **super admin** token.

## Example

```hcl
terraform {
  required_providers {
    pertisk = {
      source = "pertisktech/pertisk-gits"
    }
  }
}

provider "pertisk" {
  base_url = "https://git.example.com"
  token    = var.pertisk_token
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
```

A fuller sample lives in [`terraform-provider-pertisk-gits/examples/basic`](../terraform-provider-pertisk-gits/examples/basic).

## Resources

| Resource | Purpose |
|----------|---------|
| `pertisk_gits_group` | Create/update/delete groups (`parent_path` for subgroups) |
| `pertisk_gits_project` | Create/update/delete repositories under a group |
| `pertisk_gits_ci_variable` | CI variable (`vars.NAME`) at `server` / `group` / `repository` |
| `pertisk_gits_ci_secret` | CI secret (`secrets.NAME`); value is sensitive / write-only on read |

CI merge order: predefined → server → group → repository. See [CICD_SECRETS.md](./CICD_SECRETS.md).

## Import

| Resource | Import id |
|----------|-----------|
| Group | `full_path` (e.g. `platform/team`) |
| Project | `org_path/repo_slug` |
| CI variable/secret | `server/NAME/env`, `group/ORG/NAME/env`, `repo/ORG/REPO/NAME/env` |
