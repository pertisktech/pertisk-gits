# Terraform provider for Pertisk Gits

Manage groups, projects, and **Automation** CI variables/secrets (server, group, repository) through the Pertisk Gits HTTP API.

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
  token    = var.pertisk_token # super-admin for server scope
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

# Admin → Automation
resource "pertisk_gits_ci_variable" "server_registry" {
  scope = "server"
  name  = "HARBOR_REGISTRY"
  value = "harbor.example.com"
}

resource "pertisk_gits_ci_secret" "server_bot" {
  scope = "server"
  name  = "CI_BOT_TOKEN"
  value = var.ci_bot_token
}

# Group → Settings → Automation
resource "pertisk_gits_ci_variable" "group_sonar_url" {
  scope    = "group"
  org_path = pertisk_gits_group.platform.full_path
  name     = "SONAR_DASHBOARD_URL"
  value    = "https://sonar.example.com"
}

resource "pertisk_gits_ci_secret" "group_sonar" {
  scope    = "group"
  org_path = pertisk_gits_group.platform.full_path
  name     = "SONAR_TOKEN"
  value    = var.sonar_token
}

# Project → Settings → Automation
resource "pertisk_gits_ci_variable" "repo_service" {
  scope     = "repository"
  org_path  = pertisk_gits_group.platform.full_path
  repo_slug = pertisk_gits_project.app.slug
  name      = "SERVICE_NAME"
  value     = "app"
}

resource "pertisk_gits_ci_secret" "repo_deploy" {
  scope       = "repository"
  org_path    = pertisk_gits_group.platform.full_path
  repo_slug   = pertisk_gits_project.app.slug
  name        = "DEPLOY_TOKEN"
  environment = "prd"
  value       = var.deploy_token
}
```

## Build

```bash
cd terraform-provider-pertisk-gits
make install
```

Installs under `~/.terraform.d/plugins/registry.terraform.io/pertisktech/pertisk-gits/…`.

Optional `~/.terraformrc` `dev_overrides`:

```hcl
provider_installation {
  dev_overrides {
    "pertisktech/pertisk-gits" = "/absolute/path/to/pertisk-gits/terraform-provider-pertisk-gits"
  }
  direct {}
}
```

Env: `PERTISK_GITS_URL` / `PERTISK_URL`, `PERTISK_GITS_TOKEN` / `PERTISK_TOKEN`, `PERTISK_TLS_INSECURE`.

## Automation resources

| Resource | Pipeline | UI |
|----------|----------|-----|
| `pertisk_gits_ci_variable` | `${{ vars.NAME }}` | Automation → Variables |
| `pertisk_gits_ci_secret` | `${{ secrets.NAME }}` | Automation → Secrets |

| `scope` | API | Who | UI |
|---------|-----|-----|-----|
| `server` | `/admin/ci-secrets` | Super admin | Admin → Automation |
| `group` | `/organizations/{org}/secrets` | Group owner/admin | Group → Settings → Automation |
| `repository` | `.../repositories/{repo}/secrets` | Repo admin | Project → Settings → Automation |

Aliases: `instance`→`server`, `org`→`group`, `repo`/`project`→`repository`.

Job merge order: **predefined → server → group → repository**.

Attributes: `name`, `environment` (`all`/`dev`/`qa`/`uat`/`prd`), `value`, `masked`, and for secrets `secret_kind` (`variable`|`file`).

## Other resources

| Name | API |
|---|---|
| `pertisk_gits_group` | organizations |
| `pertisk_gits_project` | repositories |

## Import

- Group: `full_path`
- Project: `org_path/repo_slug`
- CI: `server/NAME/env`, `group/ORG/NAME/env`, `repo/ORG/REPO/NAME/env`

Examples: [`examples/basic`](examples/basic), [`examples/automation`](examples/automation). Docs: [docs/TERRAFORM.md](../docs/TERRAFORM.md), [docs/CICD_SECRETS.md](../docs/CICD_SECRETS.md).
