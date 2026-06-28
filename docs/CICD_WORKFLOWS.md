# CI/CD workflows — GitLab & GitHub Actions style

Pertisk Gits supports **GitHub Actions–like** YAML (`on`, `jobs`, `needs`, workflow graph) and **GitLab CI–like** deploy flows (environments, manual jobs, Run pipeline).

**Reference pipeline:** [`crates/cicd/examples/pertisk-ci-staged.yaml`](../crates/cicd/examples/pertisk-ci-staged.yaml)

**Related docs:** [CICD.md](./CICD.md) · [CICD_SECRETS.md](./CICD_SECRETS.md) · [PHASES.md](./PHASES.md) (Phase 4.6)

---

## Feature mapping

| GitLab CI | GitHub Actions | Pertisk Gits |
|-----------|----------------|--------------|
| `only: branches` | `on.push.branches` | `on.push.branches` + `if: branch:` |
| `only: tags` | `on.push.tags` | `on.push.tags` + `if: tag:` |
| `when: manual` | (no direct equivalent) | `if: event: manual` → **manual** job (play button) |
| Run pipeline → branch/tag | workflow_dispatch | **Run pipeline** dialog or `POST .../pipelines/trigger` |
| `environment: qa` | `environment:` (GHA) | `environment:` on job + secrets by env |
| `needs:` | `needs:` | `needs:` |
| Job rules | `if:` | Structured `if:` (`branch`, `tag`, `event`, `environment`) |
| `.gitlab-ci.yml` | `.github/workflows/*.yml` | `.pertisk-ci.yaml` |
| Migrate CI | — | **Pipelines → Migrate** (suggested YAML) |

---

## Deploy environments

| Environment | Typical trigger | Secrets example |
|-------------|-----------------|-----------------|
| **dev** | Push to `main` (automatic) | `HARBOR_URL` → dev registry |
| **qa** | Run pipeline + env **qa**, or manual play on push | `HARBOR_URL` → qa registry |
| **uat** | Run pipeline + env **uat** | `HARBOR_URL` → uat registry |
| **prd** | Tag `release/*` + manual | prod registry |

Set secrets per environment in **Group → Secrets** or **Project → Settings → Secrets**. See [CICD_SECRETS.md](./CICD_SECRETS.md).

---

## Staged workflow (recommended)

From `pertisk-ci-staged.yaml`:

| Event | Branch / ref | What runs |
|-------|--------------|-----------|
| **Push** | `main` | Build chain → deploy **dev** (automatic) |
| **Push** | `main` | `deploy-qa-manual`, `deploy-uat-manual` appear as **manual** (click play after dev chain) |
| **Push** | `feature/*` | Nothing automatic (`on.push` is `main` only) |
| **Run pipeline** | any ref + env **qa** | `deploy-qa` → `health-check-qa` → `e2e-test-qa` (automatic) |
| **Run pipeline** | any ref + env **uat** | UAT deploy chain (automatic) |
| **Run pipeline** | `feature/*` + manual | `build-feature` → `test-feature` (automatic) |

### Push to `main` (automatic dev + manual QA/UAT)

```yaml
on:
  push:
    branches: [main]

jobs:
  unit-test:
    if:
      branch: main
      event: push
    steps:
      - run: echo "unit test ok"

  deploy-dev:
    environment: dev
    needs: [release-docker]
    if:
      branch: main
      environment: dev
      event: push
    steps:
      - run: echo "deploy dev → ${{ secrets.HARBOR_URL }}"

  deploy-qa-manual:
    environment: qa
    needs: [e2e-test-dev]
    if:
      branch: main
      event: manual
    steps:
      - run: echo "deploy qa → ${{ secrets.HARBOR_URL }}"
```

After push, open the pipeline run → click **play** on `deploy-qa-manual` when upstream jobs are green.

### Run pipeline → QA (GitLab “Run pipeline”)

**UI:** Pipelines → **Run pipeline** → pick branch or tag → environment **qa** → Run.

**API:**

```bash
curl -X POST "$API/api/v1/organizations/$ORG/repositories/$REPO/pipelines/trigger" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "commit_sha": "<sha>",
    "ref_name": "refs/heads/main",
    "event_type": "manual",
    "environment": "qa"
  }'
```

Jobs with `if: environment: qa` + `event: manual` run automatically (no extra play click).

### Feature branch (manual only)

```yaml
  build-feature:
    if:
      branch: feature/*
      event: manual
    steps:
      - run: echo "building feature branch..."
```

Use **Run pipeline** on the feature branch. Jobs do **not** run on push unless `on.push.branches` includes `feature/*`.

---

## Job conditions (`if:`)

Structured form (recommended):

```yaml
if:
  branch: main          # glob: feature/*, release/*
  event: push           # push | pull_request | manual
  environment: qa       # dev | qa | uat | prd
```

String form (OR only):

```yaml
if: "branch == main || branch == qa"
```

### How `event: manual` behaves

| Pipeline trigger | Job with `event: manual` |
|------------------|---------------------------|
| **Push** / **PR** | Job status **manual** — shown in graph, **play** to start |
| **Run pipeline** (manual trigger) | Jobs with `environment: qa` etc. **queue automatically** |
| **Run pipeline** on `main` | `deploy-qa-manual` (`branch: main` + `event: manual`) stays **manual** — use play on the **push** run, not Run pipeline |

Environment-only manual jobs (no `branch:` in `if`):

```yaml
  deploy-qa:
    environment: qa
    if:
      environment: qa
      event: manual
```

- On **push** to a branch that infers env **qa** → **manual** (play).
- On **Run pipeline** with `environment: qa` → **queued** (auto).

---

## UI guide

### Pipeline list

- **Green** — all non-skipped jobs succeeded.
- **Yellow / in progress** — jobs running or queued.
- **Play icon** — manual jobs waiting (not done yet).
- Shows `event_type`, ref, and `target_environment` when set.

### Pipeline detail

- Graph shows **only jobs in this run** (skipped paths hidden).
- **Manual** jobs: play button on graph, sidebar, and job header when dependencies are satisfied.
- **Run pipeline** is on the repo Pipelines tab (not inline branch/env filters).

### Pipeline summary (config preview)

On the Pipelines tab, expand **Pipeline summary** to see all deploy paths. Use **Deploy qa** / **Deploy uat** to open Run pipeline with that environment preset.

---

## API — manual job play

After a push pipeline completes build jobs, play a manual deploy job:

```bash
curl -X POST "$API/api/v1/organizations/$ORG/repositories/$REPO/pipelines/$RUN_ID/jobs/$JOB_ID/play" \
  -H "Authorization: Bearer $JWT"
```

Returns the updated pipeline run (job moves from `manual` → `queued` → runner picks it up).

---

## Migrate from GitLab or GitHub Actions

1. Open **Project → Pipelines**.
2. If there is no `.pertisk-ci.yaml`, Pertisk detects `.gitlab-ci.yml` or `.github/workflows/*`.
3. Use **Migrate CI** to copy suggested YAML, then adjust:
   - `when: manual` → `if: event: manual`
   - `only: branches` → `if: branch: ...` or `on.push.branches`
   - `environment: qa` → job `environment:` + `if: environment: qa`

Converter lives in `crates/cicd/src/convert.rs` (warnings for unsupported features like `strategy.matrix`).

---

## Database

Migration `20250720100000_job_run_manual.sql` adds job status **`manual`**. Applied on API startup. Required for manual jobs and play API.

Extended columns (Phase 4.6):

- `pipeline_runs.target_environment`
- `job_runs.effective_environment`
- `organization_secrets.environment` / `repository_secrets.environment`

---

## Troubleshooting

| Symptom | Check |
|---------|--------|
| Pipeline list green but manual jobs not run | Expected — click **play** on manual jobs. Status should show play icon, not green-only success. |
| Run pipeline QA does nothing | `environment: qa` in trigger body; secrets set for **qa**; jobs use `if: environment: qa`. |
| 500 on pipeline detail | Redeploy API; ensure migration `manual` enum value exists (restart `pertisk-api`). |
| Manual job play disabled | Upstream `needs:` must be `success` or `skipped`. |
| Wrong Harbor URL in deploy | Secret **name** same (`HARBOR_URL`), **environment** different per env. |

---

## Minimal test config

For a small repo (`main` + `qa` branches):

```yaml
on:
  push:
    branches: [main, qa]

jobs:
  unit-test:
    if: { branch: main, event: push }
    runs-on: kubernetes
    steps:
      - run: echo "unit test ok"

  test-qa-manual:
    if: { branch: qa, event: manual }
    runs-on: kubernetes
    steps:
      - run: echo "test qa (play on push to qa)"

  deploy-qa:
    environment: qa
    if: { environment: qa, event: manual }
    runs-on: kubernetes
    steps:
      - run: echo "deploy qa → ${{ secrets.HARBOR_URL }}"
```
