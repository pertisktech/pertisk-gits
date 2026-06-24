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
git push → post-receive hook → pipeline_triggers
         → pertisk-worker → pipeline_runs + job_runs (queued)
         → pertisk-runner (poll) → shell steps → metrics_json + logs
         → commit_statuses (ci/<job>) → PR merge gate (Phase 4+)
```

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
cargo run -p pertisk-worker
```

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
export PERTISK_REPOS_ROOT=data/repos
export PERTISK_API_URL=http://127.0.0.1:8080

cargo run -p pertisk-runner
```

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
| GET | `/api/v1/organizations/{org}/repositories/{repo}/commits/{sha}/statuses` | User JWT |
| POST | `/api/v1/runners/register` | User JWT |
| GET | `/api/v1/runner/jobs?timeout_secs=25` | Runner token |
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

## Not yet implemented

- Container-isolated runners (currently shell on host)
- Artifact upload to MinIO
- Streaming logs (batch on complete today)
- PR merge required checks UI
- UI pipeline list page

See `docs/PHASES.md` Phase 4 for the full roadmap.
