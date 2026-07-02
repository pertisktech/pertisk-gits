# CI/CD secrets and variables

Group and repository **secrets** and **variables** for pipelines (GitLab-style). All values are encrypted at rest (AES-256-GCM).

| Kind | UI tab | After save | Pipeline syntax | Logs |
|------|--------|------------|-----------------|------|
| **Secret** | Secrets | Value hidden | `${{ secrets.NAME }}` | Masked by default |
| **Variable** | Variables | Value visible in UI | `${{ vars.NAME }}` | Shown unless **Mask in job logs** is enabled |

Use **variables** for non-sensitive config: SonarQube dashboard URLs, registry hostnames, API base URLs. Use **secrets** for passwords and tokens.

**Deploy workflows:** how environments tie to Run pipeline and manual jobs — [CICD_WORKFLOWS.md](./CICD_WORKFLOWS.md)

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

Reference **secrets** and **variables** in step `run` scripts and `env` values:

```yaml
jobs:
  sonar:
    environment: dev
    steps:
      - run: |
          sonar-scanner -Dsonar.host.url="$SONAR_HOST_URL"
          echo "Results: ${{ vars.SONAR_DASHBOARD_URL }}"

  deploy-qa:
    runs-on: kubernetes
    environment: qa
    if:
      environment: qa
      event: manual
    steps:
      - name: push image
        run: |
          docker login "${{ vars.HARBOR_REGISTRY }}" -u "${{ secrets.HARBOR_USERNAME }}" -p "${{ secrets.HARBOR_PASSWORD }}"
```

- **Secret `variable`** — resolves to the secret string (`${{ secrets.NAME }}`).
- **Secret `file`** — content is written to `.pertisk-secrets/NAME` on the runner (mode 600); `${{ secrets.NAME }}` resolves to that file path.
- **CI variable** — resolves via `${{ vars.NAME }}`; also exported as shell env `$NAME`.

## Runner behavior

After a job is claimed, the runner fetches decrypted values from `GET /api/v1/runner/jobs/{id}/secrets` (filtered by job environment), materializes file secrets, resolves `${{ secrets.* }}` and `${{ vars.* }}` in each step, and masks values marked **masked** in streamed logs.

## Predefined variables (GitLab-style)

Every job automatically receives GitLab-compatible **predefined variables**. They are injected as shell environment variables and available via `${{ secrets.NAME }}` in pipeline YAML. User-defined group/repository secrets **override** predefined variables with the same name.

| Variable | Description |
|----------|-------------|
| `CI_PIPELINE_ID` | Pipeline run UUID |
| `CI_PIPELINE_IID` | Pipeline number within the repository (1, 2, 3, …) |
| `CI_PIPELINE_URL` | Web URL of the pipeline run |
| `CI_PIPELINE_SOURCE` | Trigger source (`push`, `merge_request_event`, `web`) |
| `CI_PIPELINE_CREATED_AT` | Pipeline creation time (RFC 3339) |
| `CI_JOB_ID` | Job run UUID |
| `CI_JOB_NAME` | Job name from `.pertisk-ci.yaml` |
| `CI_JOB_URL` | Web URL of the job |
| `CI_JOB_MANUAL` | `true` when the pipeline was triggered manually |
| `CI_COMMIT_SHA` | Full commit SHA |
| `CI_COMMIT_SHORT_SHA` | First 8 characters of the commit SHA |
| `CI_COMMIT_REF_NAME` | Branch or tag name (without `refs/heads/` prefix) |
| `CI_COMMIT_BRANCH` | Branch name (push/PR pipelines only) |
| `CI_COMMIT_TAG` | Tag name (tag pipelines only) |
| `CI_PROJECT_PATH` | `{group}/{project}` slug path |
| `CI_PROJECT_NAMESPACE` | Group slug |
| `CI_PROJECT_URL` | Web URL of the project |
| `CI_REPOSITORY_URL` | Git clone URL |
| `CI_DEFAULT_BRANCH` | Repository default branch |
| `CI_CONFIG_PATH` | Path to the pipeline config file used |
| `CI_ENVIRONMENT_NAME` | Effective deploy environment (`dev` / `qa` / `uat` / `prd`) |
| `CI_SERVER_URL` | Git server base URL |
| `CI_MERGE_REQUEST_*` | Merge request fields when the pipeline runs for a PR |

Example:

```yaml
jobs:
  report:
    runs-on: linux
    steps:
      - run: |
          echo "Pipeline ${{ secrets.CI_PIPELINE_IID }} on ${{ secrets.CI_COMMIT_REF_NAME }}"
          curl -sf "${{ secrets.CI_PIPELINE_URL }}"
```

Or use standard shell variables (same values):

```yaml
      - run: echo "$CI_PIPELINE_ID $CI_JOB_NAME"
```

## UI locations

- **Group → Secrets** — group-level secrets and variables (tabs)
- **Project → Settings → Automation** — repository secrets and variables
