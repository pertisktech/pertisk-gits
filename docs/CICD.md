# Pertisk Gits CI/CD (Phase 4)

CI pipelines triggered on **push**, **pull_request**, and **manual** (Run pipeline), executed by **Rust runners** with per-step performance metrics.

**Workflow guide (GitLab + GitHub Actions style):** [CICD_WORKFLOWS.md](./CICD_WORKFLOWS.md) · **Secrets by environment:** [CICD_SECRETS.md](./CICD_SECRETS.md)

## Architecture

| Component | Binary / crate | Role |
|-----------|----------------|------|
| Pipeline config | `.pertisk-ci.yaml` in repo root | Declares `on:`, `jobs`, `steps` |
| Scheduler | `pertisk-worker` | Processes `pipeline_triggers`, creates `job_runs` |
| API | `pertisk-api` | Runner poll/complete, pipeline status, commit checks |
| Runner | `pertisk-runner` | Executes steps in workspace, reports metrics |

```
git push → post-receive hook (HTTP or SSH) → pipeline_triggers
         → pertisk-api flush (immediate) or pertisk-worker (poll) → pipeline_runs + job_runs
         → pertisk-runner (poll) → shell steps → metrics_json + logs
         → commit_statuses (ci/<job>) → PR merge gate
```

Push triggers run on **both** Git HTTP and Git SSH. The API processes triggers right after push; `pertisk-worker` is a backup poller.

## Quick start

### 1. Add pipeline config to a repo

Copy the example to your repo root as `.pertisk-ci.yaml`:

```bash
cp crates/cicd/examples/pertisk-ci-rust-perf.yaml /path/to/your/repo/.pertisk-ci.yaml
git add .pertisk-ci.yaml && git commit -m "Add CI pipeline" && git push
```

### 2. Run worker + API

```bash
make infra
export DATABASE_URL=postgres://pertisk:pertisk@localhost:5432/pertisk_gits
export JWT_SECRET=dev-secret
export REPOS_ROOT=data/repos

cargo run -p pertisk-api &
cargo run -p pertisk-worker   # optional backup; API also processes triggers on push
```

### Push did not start a pipeline?

1. **`.pertisk-ci.yaml` must be in the pushed commit** on the branch you push (not only locally).
2. **`on.push.branches`** must include your branch (e.g. `main`).
3. **Redeploy `pertisk-api`** — SSH push used to skip the CI hook (fixed in recent builds).
4. On the server: `sudo systemctl status pertisk-gits pertisk-worker` and check logs:
   `journalctl -u pertisk-gits -f` for `pipeline triggered by push` or `trigger skipped`.
5. **Runners** must be online with labels matching `runs-on` (e.g. `linux`, `docker`).

### 3. Register a runner

```bash
# With a user JWT from the web UI / login API:
curl -X POST http://localhost:8080/api/v1/runners/register \
  -H "Authorization: Bearer $USER_JWT" \
  -H "Content-Type: application/json" \
  -d '{"name":"local-rust-runner"}'
# → { "runner_id": "...", "token": "ptr_..." }
```

### 4. Start the runner

```bash
export PERTISK_RUNNER_TOKEN=ptr_...
export PERTISK_API_URL=http://127.0.0.1:8080

# Optional: local bare-repo checkout (same host as pertisk-gits, or NFS mount).
# If unset or the repo path is missing, the runner downloads the workspace from the API.
export PERTISK_REPOS_ROOT=data/repos

cargo run -p pertisk-runner
```

**Deployment options:** systemd (RPM), Docker, Compose, Kubernetes — see [RUNNERS.md](./RUNNERS.md).

### Distributed runners

Runners do **not** need to live on the git server. Set `PERTISK_API_URL` to your pertisk-gits API (e.g. `https://git.example.com`). When `PERTISK_REPOS_ROOT` is unset or the bare repo is not on disk, checkout is served by the API from the server's `REPOS_ROOT`.

For lowest latency on the git host, colocate the runner and set `PERTISK_REPOS_ROOT` to the same path as `REPOS_ROOT` (e.g. `/var/lib/pertisk-gits/repos`).

### Docker build jobs

CI steps run as the **`pertisk-runner`** systemd user, not your SSH login user. Adding yourself to the `docker` group does not fix pipeline `docker build` failures.

On the host that runs `build-docker` (runner label `devops-proxy-apps` or similar):

```bash
sudo usermod -aG docker pertisk-runner
sudo systemctl restart pertisk-runner
```

Verify:

```bash
sudo -u pertisk-runner docker ps
```

The runner RPM postinstall also adds `pertisk-runner` to the `docker` group when Docker is installed.

### Self-build pipeline (this repo)

Root `.pertisk-ci.yaml` defines `build-runner` and `build-package` jobs (`runs-on: docker`) that produce RPM artifacts via `make package-runner-amd64` / `make package-amd64`. Set `PERTISK_FORCE_DOCKER_BUILD=1` in CI so binaries, web UI (`docker/Dockerfile.web`), and fpm packaging use Docker on the runner host (no host `npm` or `fpm` required).

## Performance testing

Hard-test parser, scheduler, and runner overhead:

```bash
chmod +x scripts/cicd-perf-test.sh
./scripts/cicd-perf-test.sh
```

### Criterion benches (parser + scheduler)

```bash
cargo bench -p pertisk-cicd --bench pipeline
# HTML report: target/criterion/report/index.html
```

### Runner noop overhead

Measures shell spawn + `true` step latency (p50/p95/max):

```bash
cargo run -p pertisk-runner -- bench --iterations 200
```

Example output:

```json
{
  "iterations": 200,
  "noop_step_ms_p50": 12,
  "noop_step_ms_p95": 18,
  "noop_step_ms_max": 45,
  "shell_spawn_overhead_ms": 11
}
```

### Rust perf pipeline example

`crates/cicd/examples/pertisk-ci-rust-perf.yaml` runs:

1. `cargo fmt --check`
2. `cargo clippy`
3. `cargo test --release`
4. `cargo bench -p pertisk-cicd`
5. `pertisk-runner bench`
6. Release binary size check

## Pipeline YAML reference (MVP)

```yaml
on:
  push:
    branches: [main, release/*]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: linux
    needs: []          # optional DAG deps
    required: true     # default; optional job: allow_failure: true or required: false
    timeout_minutes: 30  # optional; kills the job after N minutes (runner + API reclaim)
    if:                  # optional — structured or string (see CICD_WORKFLOWS.md)
      branch: main       # branch pushes only; use tag: for tag pushes
      event: push
    environment: dev   # optional — dev | qa | uat | prd (secrets); separate from if: environment:
    steps:
      - name: Build
        run: cargo build --release
        working-directory: crates/api   # optional
        env:
          RUSTFLAGS: "-D warnings"
```

### Allow failure (optional jobs)

Set **`allow_failure: true`** (GitLab) or **`required: false`** on a job when its failure should not fail the pipeline or block dependents:

```yaml
jobs:
  lint:
    runs-on: linux
    allow_failure: true
    steps:
      - run: npm run lint

  build:
    runs-on: linux
    needs: [lint]   # still runs if lint failed
    steps:
      - run: npm run build
```

- Optional failures do **not** cancel queued downstream jobs or mark the pipeline failed.
- PR merge gate ignores optional job failures (same as `required: false` on commit status).
- UI shows allowed failures in **amber** on the pipeline graph.

See [CICD_WORKFLOWS.md](./CICD_WORKFLOWS.md#allow-failure-optional-jobs) for full behavior and GitLab mapping.

### Manual jobs and Run pipeline

Jobs with `if: event: manual` behave like GitLab `when: manual`:

- On **push** / **PR** → job status **manual** (play button in UI).
- On **Run pipeline** with matching `environment` → job queues automatically.

Staged example: `crates/cicd/examples/pertisk-ci-staged.yaml`. Tag releases and `if:` rules: [CICD_WORKFLOWS.md](./CICD_WORKFLOWS.md#tag-push-release-on-any-tag).

### Run pipeline (manual trigger)

**UI:** Project → Pipelines → **Run pipeline** → branch or tag + optional environment.

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

`environment` sets `pipeline_runs.target_environment` so env-scoped jobs and secrets resolve correctly.

## API endpoints

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/v1/organizations/{org}/repositories/{repo}/pipelines` | User JWT |
| GET | `/api/v1/organizations/{org}/repositories/{repo}/pipelines/{run_id}` | User JWT |
| POST | `/api/v1/organizations/{org}/repositories/{repo}/pipelines/trigger` | User JWT (write); body may include `environment` |
| POST | `/api/v1/organizations/{org}/repositories/{repo}/pipelines/{run_id}/jobs/{job_id}/play` | User JWT (write); start a **manual** job |
| POST | `/api/v1/organizations/{org}/repositories/{repo}/pipelines/{run_id}/jobs/{job_id}/rerun` | User JWT (write); re-run one job (+ downstream `needs`) |
| GET | `/api/v1/organizations/{org}/repositories/{repo}/pipelines/config` | User JWT |
| POST | `/api/v1/organizations/{org}/repositories/{repo}/pipelines/{run_id}/cancel` | User JWT (write) |
| POST | `/api/v1/organizations/{org}/repositories/{repo}/pipelines/{run_id}/cancel-step` | User JWT (write) |
| DELETE | `/api/v1/organizations/{org}/repositories/{repo}/pipelines/{run_id}` | User JWT (write) |
| POST | `/api/v1/organizations/{org}/repositories/{repo}/pipelines/{run_id}/rerun` | User JWT (write) |
| GET | `/api/v1/organizations/{org}/repositories/{repo}/commits/{sha}/statuses` | User JWT |
| POST | `/api/v1/runners/register` | User JWT |
| GET | `/api/v1/runner/jobs?timeout_secs=25` | Runner token |
| POST | `/api/v1/runner/jobs/{id}/log` | Runner token (append live log) |
| GET | `/api/v1/runner/jobs/{id}/workspace` | Runner token |
| POST | `/api/v1/runner/jobs/{id}/complete` | Runner token |
| POST | `/api/v1/runner/jobs/{id}/artifacts` | Runner token (multipart upload) |
| GET | `/api/v1/organizations/{org}/repositories/{repo}/pipelines/{run_id}/artifacts/{id}/download` | User JWT |

## Job metrics

Each completed job stores `metrics_json`:

```json
{
  "job_name": "test",
  "queue_wait_ms": 120,
  "execution_ms": 8420,
  "total_ms": 8540,
  "steps": [
    {
      "name": "Build",
      "duration_ms": 4200,
      "exit_code": 0,
      "started_at": "...",
      "finished_at": "..."
    }
  ]
}
```

Use this to track runner performance regressions over time.

### Pull request pipelines

Pipelines with `on.pull_request` run when:

- A pull request is **opened** (source branch head is enqueued)
- New commits are **pushed** to an open PR’s source branch (post-receive hook)

`ref_name` is the **target** branch (e.g. `refs/heads/main`); `commit_sha` is the PR head.

### Merge gate

If the PR head commit has **required** `commit_statuses` (from CI jobs with `required: true`), merge is blocked until every required `ci/*` check is `success`. Jobs with `required: false` still run and appear on the commit/PR, but failures do not block merge.

### Live logs

While a step runs, the runner streams stdout/stderr to the API in ~400ms chunks (`POST /runner/jobs/{id}/log`). Each step starts with `=== name (running)` and ends with `=== name (exit N)` or `=== name (exit cancelled)`. The pipeline detail page polls every 1 second while a run is in progress.

### Fail-fast and runner status

When a **required** job fails, remaining `queued` / `running` jobs are marked failed (`=== skipped: pipeline failed`) and are not claimed again. Runners return to **online** instead of staying **busy** while sibling jobs would have run.

Jobs with **`allow_failure: true`** / **`required: false`** do not trigger fail-fast: downstream `needs:` jobs still queue, and the pipeline can finish **success** if every required job passed.

Parallel required jobs without `needs` still follow fail-fast (first required failure stops the run).

### Cancel pipeline / cancel step

While a run is **running**, the pipeline detail page shows **Cancel pipeline** and **Cancel step** (for the active step). The API sets the run or job to `cancelled`; the runner polls `GET /runner/jobs/{id}/control` and kills the current shell step (exit 130). Runners return to **online** when no jobs are `running`.

Requires migration `20250629100000_pipeline_cancel.sql` (applied automatically when `pertisk-gits` starts).

### Manual job play

When a job is **manual** (waiting for operator approval), play it from the pipeline detail page or:

```bash
curl -X POST "$API/api/v1/organizations/$ORG/repositories/$REPO/pipelines/$RUN_ID/jobs/$JOB_ID/play" \
  -H "Authorization: Bearer $JWT"
```

The job moves `manual` → `queued` → `running`. A pipeline run stays **in progress** while any job is `manual`, `queued`, or `running` (not marked success until manual jobs are played or skipped).

Requires migration `20250720100000_job_run_manual.sql`.

### Re-run

Re-run resets the **same** pipeline run (same run ID and job rows) instead of creating a duplicate entry in the pipeline list. Previous artifact files on disk are removed when the run is reset.

POST body `{ "scope": "failed" }` re-queues only jobs that are not `success` (failed, cancelled, queued downstream, etc.). Successful jobs keep their logs and artifacts.

**Re-run a single job** from the pipeline detail page (**Re-run job** on a finished job in the sidebar or job header), or:

```bash
curl -X POST "$API/api/v1/organizations/$ORG/repositories/$REPO/pipelines/$RUN_ID/jobs/$JOB_ID/rerun" \
  -H "Authorization: Bearer $JWT"
```

The selected job and any downstream jobs (via `needs`) are reset and **queued to run immediately** (GitLab-style retry). Manual jobs (`when: manual`) are not sent back to the play button — they execute like any other job. Upstream jobs that already succeeded are left unchanged. Works for **manual**, **success**, **failed**, **cancelled**, and **skipped** jobs — only **queued** / **running** jobs cannot be re-run until they finish.

**UI:** Each job in the pipeline graph, sidebar, job header, and log panel shows **Re-run job** (↻). Manual jobs waiting for first play still use **Run job** (▶).

### Delete pipeline run

Finished runs can be deleted from the pipeline detail page (**Delete**). This removes the run from the database (jobs and artifact rows cascade) and deletes stored files under `ARTIFACTS_ROOT`.

### Artifacts

Jobs can publish build outputs as downloadable `.tar.gz` archives. Storage defaults to `data/artifacts` on the API host (`ARTIFACTS_ROOT`).

**Job-level** (uploaded after all steps succeed):

```yaml
jobs:
  build:
    runs-on: linux
    steps:
      - run: cargo build --release -p pertisk-api
    artifacts:
      - name: pertisk-api-release
        path: target/release/pertisk-api
```

**Step-level** (`uses: upload-artifact`):

```yaml
    steps:
      - run: echo hello > report.txt
      - name: Upload report
        uses: upload-artifact
        with:
          name: report
          path: report.txt
```

Paths are relative to the job workspace. The runner archives each path with `tar -czf` before upload. On the pipeline run detail page, artifacts appear under the selected job with a **Download** button.

## Not yet implemented

- Container-isolated runners (currently shell on host)
- S3-compatible object storage backend (MinIO is in `deploy/docker-compose.yml` for future use)
- Per-branch required checks configuration in repo settings (merge gate uses `required` per job in YAML today)

See `docs/PHASES.md` Phase 4 for the full roadmap.
