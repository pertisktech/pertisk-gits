# Terraform provider for Pertisk Gits

Manage groups, projects, and CI variables/secrets through the Pertisk Gits HTTP API.

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

## Build

The provider is not on the Terraform Registry yet. Build and install a local plugin copy:

```bash
cd terraform-provider-pertisk-gits
make install
```

That places the binary under `~/.terraform.d/plugins/registry.terraform.io/pertisktech/pertisk-gits/…`. Then run `terraform init` in your root module.

For a quicker edit/test loop, point Terraform at the **directory that contains the binary** with a [CLI config](https://developer.hashicorp.com/terraform/cli/config/config-file) `dev_overrides` block (`~/.terraformrc` on macOS/Linux):

```hcl
provider_installation {
  dev_overrides {
    "pertisktech/pertisk-gits" = "/absolute/path/to/pertisk-gits/terraform-provider-pertisk-gits"
  }
  direct {}
}
```

`dev_overrides` skips `terraform init` downloads for that source. Credentials can also come from the environment: `PERTISK_GITS_URL` / `PERTISK_URL`, `PERTISK_GITS_TOKEN` / `PERTISK_TOKEN`, `PERTISK_TLS_INSECURE`.

## Resources

| Name | API |
|---|---|
| `pertisk_gits_group` | `POST/PATCH/DELETE /api/v1/organizations` |
| `pertisk_gits_project` | `POST/PATCH/DELETE /api/v1/organizations/{path}/repositories` |
| `pertisk_gits_ci_variable` | CI `config_scope=variable` at server / group / repository |
| `pertisk_gits_ci_secret` | CI `config_scope=secret` at server / group / repository |

### CI scopes

| `scope` | Path | Who can manage |
|---------|------|----------------|
| `server` | `/admin/ci-secrets` | Super admin |
| `group` | `/organizations/{org_path}/secrets` | Group owner/admin |
| `repository` | `.../repositories/{repo}/secrets` | Repo admin |

Merge order for jobs: **predefined → server → group → repository**.

### Import

- Group: `full_path` (e.g. `platform` or `platform/team`)
- Project: `org_path/repo_slug` (e.g. `platform/app`)
- CI variable/secret: `server/NAME/env`, `group/ORG/NAME/env`, or `repo/ORG/REPO/NAME/env`

See also [docs/TERRAFORM.md](../docs/TERRAFORM.md) and [docs/CICD_SECRETS.md](../docs/CICD_SECRETS.md).
