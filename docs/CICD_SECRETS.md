# CI/CD secrets

Group and repository secrets for pipelines. Values are encrypted at rest (AES-256-GCM) and never returned by the API after creation.

## Configuration

Set `SECRETS_ENCRYPTION_KEY` to a 32-byte key (base64 or hex). If unset, the API derives a key from `JWT_SECRET` (development only — set a dedicated key in production).

## Scopes

| Scope | Table | Who can manage | Visibility |
|-------|-------|----------------|------------|
| Group | `organization_secrets` | Org owner/admin | All pipelines in the group |
| Repository | `repository_secrets` | Repo admin or org owner/admin | Pipelines in that repository only |

Repository secrets override group secrets with the **same name and environment**.

## Secrets by environment

Each secret has an **environment**: `dev`, `qa`, `uat`, `prd`, or `all`.

Use the **same variable name** in each environment with a **different value**:

| Environment | Name | Value (example) |
|-------------|------|-----------------|
| dev | `HARBOR_URL` | `harbor-dev.tools.thaidevops.co` |
| qa | `HARBOR_URL` | `harbor-qa.tools.thaidevops.co` |
| uat | `HARBOR_URL` | `harbor-uat.tools.thaidevops.co` |
| prd | `HARBOR_URL` | `harbor.tools.thaidevops.co` |
| all | `CI_TOKEN` | shared across every environment |

### UI

1. Open **Group → Secrets** (shared) or **Project → Settings → Repository secrets**.
2. Click **Add secret**.
3. Set **Name** = `HARBOR_URL`, **Environment** = `dev`, **Value** = your dev Harbor URL.
4. Repeat for `qa`, `uat`, `prd` with the same name and different values.

The secrets list is grouped by environment (dev / qa / uat / prd / all).

### Which secrets a job receives

A job gets secrets where:

- environment is **`all`**, or
- environment matches the job’s **effective environment** (`dev` / `qa` / `uat` / `prd`)

Effective environment comes from (in order):

1. `environment:` on the job in `.pertisk-ci.yaml`
2. `target_environment` on the pipeline run (manual trigger or inferred from branch/tag)
3. Job name suffix (e.g. `deploy-qa` → `qa`)

## Pipeline usage

Reference secrets in step `run` scripts and `env` values:

```yaml
jobs:
  deploy-qa:
    runs-on: kubernetes
    environment: qa
    if: environment == qa
    steps:
      - name: push image
        run: |
          echo "Logging in to ${{ secrets.HARBOR_URL }}"
          docker login "${{ secrets.HARBOR_URL }}" -u "$USER" -p "$PASS"
```

- **variable** — resolves to the secret string.
- **file** — content is written to `.pertisk-secrets/NAME` on the runner (mode 600); the reference resolves to that file path.

## Runner behavior

After a job is claimed, the runner fetches decrypted secrets from `GET /api/v1/runner/jobs/{id}/secrets` (filtered by job environment), materializes file secrets, resolves `${{ secrets.* }}` in each step, and masks known secret values in streamed logs.

## UI locations

- **Group → Secrets** — group-level secrets
- **Project → Settings** — repository secrets section
