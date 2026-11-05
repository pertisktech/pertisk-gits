# Terraform / OpenTofu provider

Manage Pertisk Gits groups, projects, and **Automation** CI variables/secrets at server, group, and repository level.

Provider source: `pertisktech/pertisk-gits` (local install until published to the registry).

## Install

```bash
cd terraform-provider-pertisk-gits
make install
```

Builds `bin/terraform-provider-pertisk-gits` into
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

```hcl
provider "pertisk" {
  base_url = "https://git.example.com"
  token    = var.pertisk_token
  # insecure = true
}
```

Environment: `PERTISK_GITS_URL` / `PERTISK_URL`, `PERTISK_GITS_TOKEN` / `PERTISK_TOKEN`, `PERTISK_TLS_INSECURE`.

`scope = "server"` requires a **super admin** token.

## Automation (secrets & variables)

Same data as the UI:

| Level | UI | Terraform `scope` |
|-------|----|-------------------|
| Server | Admin → Automation | `server` |
| Group | Group → Settings → Automation | `group` (+ `org_path`) |
| Repository | Project → Settings → Automation | `repository` (+ `org_path`, `repo_slug`) |

| Resource | Kind | Pipeline |
|----------|------|----------|
| `pertisk_gits_ci_variable` | Variable | `${{ vars.NAME }}` |
| `pertisk_gits_ci_secret` | Secret | `${{ secrets.NAME }}` |

Merge order: **predefined → server → group → repository**. See [CICD_SECRETS.md](./CICD_SECRETS.md).

```hcl
# Server
resource "pertisk_gits_ci_variable" "registry" {
  scope = "server"
  name  = "HARBOR_REGISTRY"
  value = "harbor.example.com"
}

resource "pertisk_gits_ci_secret" "bot" {
  scope = "server"
  name  = "CI_BOT_TOKEN"
  value = var.ci_bot_token
}

# Group
resource "pertisk_gits_ci_variable" "sonar_url" {
  scope    = "group"
  org_path = pertisk_gits_group.platform.full_path
  name     = "SONAR_DASHBOARD_URL"
  value    = "https://sonar.example.com"
}

resource "pertisk_gits_ci_secret" "sonar" {
  scope    = "group"
  org_path = pertisk_gits_group.platform.full_path
  name     = "SONAR_TOKEN"
  value    = var.sonar_token
}

# Repository (optional per-environment)
resource "pertisk_gits_ci_secret" "deploy" {
  scope       = "repository"
  org_path    = pertisk_gits_group.platform.full_path
  repo_slug   = pertisk_gits_project.app.slug
  name        = "DEPLOY_TOKEN"
  environment = "prd"
  value       = var.deploy_token
}
```

Scope aliases: `instance`→`server`, `org`→`group`, `repo`/`project`→`repository`.

Secret `secret_kind`: `variable` (default) or `file`.

## Groups and projects

```hcl
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
```

## Examples

- [`terraform-provider-pertisk-gits/examples/basic`](../terraform-provider-pertisk-gits/examples/basic) — group + project + variable/secret at all three levels
- [`terraform-provider-pertisk-gits/examples/automation`](../terraform-provider-pertisk-gits/examples/automation) — automation-only against an existing group/repo

## Import

| Resource | Import id |
|----------|-----------|
| Group | `full_path` |
| Project | `org_path/repo_slug` |
| CI variable/secret | `server/NAME/env`, `group/ORG/NAME/env`, `repo/ORG/REPO/NAME/env` |
