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
| `allow_failure: true` | `continue-on-error` (job-level) | `allow_failure: true` or `required: false` |
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
| **prd** | Tag `release/*` (inferred) or Run pipeline + **prd** | prod registry |

Set secrets per environment in **Group → Secrets** or **Project → Settings → Secrets**. See [CICD_SECRETS.md](./CICD_SECRETS.md).

### Inferred environment (for `if: environment:`)

When a run has no explicit **Run pipeline** environment, Pertisk infers `environment` from the ref:

| Ref | Inferred environment |
|-----|----------------------|
| `refs/heads/main` | `dev` |
| `refs/heads/qa` | `qa` |
| `refs/heads/uat` | `uat` |
| `refs/tags/release/*` | `prd` |
| Other branches / tags (e.g. `v1.0.0`) | *(none)* |

Use **`environment:` on the job** to load secrets for that env. Use **`if: environment:`** only when the ref (or Run pipeline target) actually infers or sets that env — see [Job `environment:` vs `if: environment:`](#job-environment-vs-if-environment) below.

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

### Tag push (release on any tag)

To run a deploy job when **any tag** is pushed:

1. Add **`on.push.tags`** so tag pushes start a pipeline.
2. Use **`if: tag:`** on the job — **`if: branch:` never matches tag pushes**.
3. Put **`environment: dev`** (or qa/uat/prd) on the **job** for secrets; do **not** add `environment: dev` to `if:` unless the tag ref infers that env (see table above).

```yaml
on:
  push:
    branches: [main]
    tags: ['*']              # any tag push triggers a pipeline

jobs:
  unit-test:
    if:
      branch: main
      event: push
    steps:
      - run: npm test

  release-dev:
    runs-on: docker
    environment: dev         # dev secrets (HARBOR_URL, etc.)
    if:
      tag: '*'               # also: tag: true  or  if: tag
      event: push
    steps:
      - run: echo "release to dev on tag $REF"
```

Push a tag:

```bash
git tag v1.0.0
git push origin v1.0.0
```

For **release tags only** (`release/1.0.0`), use `tag: release/*` in `if:` and optionally `on.push.tags: [release/*]`.

**Common mistake:** `if: branch: release/*` on a tag push — the pipeline may start (if the tag name matches a branch pattern), but the job is still skipped because branch conditions do not apply to tags.

---

## Job conditions (`if:`)

Structured form (recommended):

```yaml
if:
  branch: main          # glob: feature/*, release/* — branch pushes only
  tag: release/*        # glob: v*, * — tag pushes only (use tag: '*' for any tag)
  event: push           # push | pull_request | manual
  environment: qa       # dev | qa | uat | prd (inferred ref or Run pipeline target)
```

String form (OR only):

```yaml
if: "branch == main || branch == qa"
if: tag                 # shorthand: any tag push
```

### Job `environment:` vs `if: environment:`

| Field | Purpose |
|-------|---------|
| **`environment:` on the job** | Which secrets / deploy target the job uses (`HARBOR_URL` for dev, qa, …). Always set this when the job deploys to an env. |
| **`if: environment:`** | Filter: job runs only when the **run context** has that environment (inferred from ref or set by **Run pipeline**). |

Examples:

- **Push to `main`**, deploy dev — both work together because `main` infers `dev`:
  ```yaml
  environment: dev
  if:
    branch: main
    environment: dev
    event: push
  ```
- **Tag push `v1.0.0`**, deploy using **dev secrets** — use job `environment: dev` only; omit `environment: dev` from `if:` (tag `v1.0.0` does not infer `dev`):
  ```yaml
  environment: dev
  if:
    tag: '*'
    event: push
  ```
- **Run pipeline** on a tag with `environment: qa` — jobs with `if: environment: qa` + `event: manual` queue automatically.

### Branch vs tag conditions

- On a **tag push**, `if: branch: …` is always false (even if the tag name looks like a branch, e.g. `release/1.0.0`).
- On a **branch push**, `if: tag: …` is always false.
- `on.push.tags` and `on.push.branches` control whether the **pipeline** starts; job `if:` controls which **jobs** are included.

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

## Allow failure (optional jobs)

GitLab-style **`allow_failure: true`** lets a job fail without failing the pipeline or blocking downstream jobs. Use the same idea as GitHub Actions job-level tolerance (not per-step `continue-on-error`).

| YAML | Meaning |
|------|---------|
| `allow_failure: true` | Job is optional (GitLab naming) |
| `required: false` | Same as above (explicit inverse) |

Default is **`required: true`** (failures stop the run and block merge).

### Behavior

| When an optional job fails | Effect |
|----------------------------|--------|
| Pipeline status | Stays **success** if all **required** jobs passed |
| Downstream `needs:` | Still runs (failed optional job counts as satisfied) |
| PR merge gate | Does **not** block (`required: false` on `ci/<job>` status) |
| Failure email | Not sent for optional-only failures |
| UI | Job shows **amber/warning** (allowed failure), not red |

Required job failures still fail the pipeline, cancel remaining queued jobs, and block merge.

### Example

```yaml
jobs:
  lint:
    runs-on: linux
    allow_failure: true
    steps:
      - run: npm run lint

  build:
    runs-on: linux
    needs: [lint]          # runs even if lint fails
    steps:
      - run: npm run build

  bench:
    runs-on: linux
    required: false        # same as allow_failure: true
    needs: [build]
    steps:
      - run: cargo bench --no-run
```

**Migrate from GitLab:** `allow_failure: true` in `.gitlab-ci.yml` converts to `required: false` in suggested `.pertisk-ci.yaml`.

---

## UI guide

### Pipeline list

- **Green** — all non-skipped jobs succeeded.
- **Yellow / in progress** — jobs running or queued.
- **Play icon** — manual jobs waiting (not done yet).
- Shows `event_type`, ref, and `target_environment` when set.

### Pipeline detail

- Graph shows **non-skipped jobs** in this run (path-skipped jobs are hidden).
- If **every** job is skipped, the run shows **Skipped**, **No jobs defined**, and an empty job list — fix job `if:` conditions (see [Troubleshooting](#troubleshooting)).
- **Manual** jobs: play button on graph, sidebar, and job header when dependencies are satisfied.
- **Allowed failure** — amber icon on jobs with `allow_failure: true` / `required: false` that failed.
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
   - `allow_failure: true` → `required: false` (or keep `allow_failure: true` in YAML)
   - `only: branches` → `if: branch: ...` or `on.push.branches`
   - `environment: qa` → job `environment:` + `if: environment: qa`

Converter lives in `crates/cicd/src/convert.rs` (warnings for unsupported features like `strategy.matrix`).

---

## Database

Migration `20250720100000_job_run_manual.sql` adds job status **`manual`**. Applied on API startup. Required for manual jobs and play API.

Extended columns (Phase 4.6):

- `pipeline_runs.target_environment`
- `job_runs.effective_environment`
- `job_runs.required` (optional vs required job; migration `20260703100000_job_runs_required.sql`)
- `organization_secrets.environment` / `repository_secrets.environment`

---

## Troubleshooting

| Symptom | Check |
|---------|--------|
| Pipeline triggered but **No jobs** / status **Skipped** | Every job’s `if:` failed. On tag push: use `if: tag:` not `if: branch:`; remove `if: environment: dev` unless ref infers `dev` (see [inferred environment](#inferred-environment-for-if-environment)). |
| Tag push does not start a pipeline | Add `on.push.tags: ['*']` or a matching pattern. |
| `release-dev` skipped on tag `v1.0.0` | Drop `environment: dev` from `if:`; keep `environment: dev` on the job for secrets. |
| Pipeline list green but manual jobs not run | Expected — click **play** on manual jobs. Status should show play icon, not green-only success. |
| Run pipeline QA does nothing | `environment: qa` in trigger body; secrets set for **qa**; jobs use `if: environment: qa`. |
| 500 on pipeline detail | Redeploy API; ensure migration `manual` enum value exists (restart `pertisk-api`). |
| Manual job play disabled | Upstream `needs:` must be `success`, `skipped`, or **failed optional** (`allow_failure: true`). |
| Optional job still fails pipeline | Remove `required: true` default — set `allow_failure: true` or `required: false`. |
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
