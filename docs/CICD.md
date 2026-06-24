# Pertisk Gits CI/CD (Phase 4)

Self-hosted pipelines triggered on **push** and **pull_request**, executed by **Rust runners** with per-step performance metrics.

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
5. **Runners** must be online with labels matching `runs-on` (`self-hosted`, `docker`, etc.).

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
    runs-on: self-hosted
    needs: []          # optional DAG deps
    required: true     # default; set false for optional jobs (excluded from merge gate)
    timeout_minutes: 30  # optional
    steps:
      - name: Build
        run: cargo build --release
        working-directory: crates/api   # optional
        env:
          RUSTFLAGS: "-D warnings"
```

## API endpoints

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/v1/organizations/{org}/repositories/{repo}/pipelines` | User JWT |
| GET | `/api/v1/organizations/{org}/repositories/{repo}/pipelines/{run_id}` | User JWT |
| POST | `/api/v1/organizations/{org}/repositories/{repo}/pipelines/trigger` | User JWT (write) |
| GET | `/api/v1/organizations/{org}/repositories/{repo}/pipelines/config` | User JWT |
| POST | `/api/v1/organizations/{org}/repositories/{repo}/pipelines/{run_id}/rerun` | User JWT (write) |
| GET | `/api/v1/organizations/{org}/repositories/{repo}/commits/{sha}/statuses` | User JWT |
| POST | `/api/v1/runners/register` | User JWT |
| GET | `/api/v1/runner/jobs?timeout_secs=25` | Runner token |
| POST | `/api/v1/runner/jobs/{id}/log` | Runner token (append live log) |
| GET | `/api/v1/runner/jobs/{id}/workspace` | Runner token |
| POST | `/api/v1/runner/jobs/{id}/complete` | Runner token |

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

While a job runs, the runner appends log output to the API after **each step** completes (`POST /runner/jobs/{id}/log`). The pipeline detail page polls every few seconds, so logs update during the run without waiting for job completion.

### Re-run

Re-run resets the **same** pipeline run (same run ID and job rows) instead of creating a duplicate entry in the pipeline list.

## Not yet implemented

- Container-isolated runners (currently shell on host)
- Artifact upload to MinIO
- Intra-step log streaming (stdout/stderr while a step is running)
- Per-branch required checks configuration in repo settings (merge gate uses `required` per job in YAML today)

See `docs/PHASES.md` Phase 4 for the full roadmap.
