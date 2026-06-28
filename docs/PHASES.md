# Pertisk Gits — Development Phases

Git platform (GitHub / GitLab / Gitea alternative) built with **Rust**, **React**, and **PostgreSQL**.

**Stack:** [Pingora](https://github.com/cloudflare/pingora) (edge gateway), [Quiche](https://github.com/cloudflare/quiche) (HTTP/3, later), axum (API), PostgreSQL, Redis, object storage.

---

## Phase 0 — Foundation

**Goal:** Monorepo, auth, orgs, and empty repo CRUD.

| Deliverable | Status |
|-------------|--------|
| Rust workspace (`domain`, `api`, `gateway`) | Done |
| PostgreSQL schema migrations | Done |
| Auth: register, login, JWT | Done |
| Organizations & repositories CRUD | Done |
| Basic RBAC (org owner, repo admin) | Done |
| Pingora gateway (proxy to API) | Done |
| React shell (login, org/repo list) | Done |
| Docker Compose (Postgres, Redis, MinIO) | Done |

**Schema:** `users`, `organizations`, `organization_members`, `repositories`, `repository_permissions`, `api_tokens`, `user_ssh_keys`

---

## Phase 1 — Git Repository Hosting

**Goal:** Real `git clone`, `push`, `pull` over HTTPS and SSH.

| Deliverable | Status |
|-------------|--------|
| Bare repo storage | Done |
| Git Smart HTTP | Done |
| SSH access | Done |
| Branch/tag UI | Done |
| Repo settings | Done |
| Web file browser | Done (public repos readable without login) |
| Web file editor | Done (browse table → edit mode, tree explorer, commit on branch) |
| Line numbers in code view | Done |
| Raw file download | Done |
| Commits UI | Done (blame later) |

**Gateway routes:** `/*.git/*` → `git-http` service

---

## Phase 2 — Collaboration Core (Done)

**Goal:** Issues and Pull/Merge Requests.

### Issue Tracking
| Feature | Status |
|---------|--------|
| Issues CRUD + comments | Done |
| Labels | Done |
| Milestones | Done (create + assign UI) |
| Assignees | Done |
| Markdown body | Done |
| `@mentions`, cross-links | Done (#issues, !PRs) |
| Filters and repo search | Done (state + text search) |
| Group members + repo access | Done |

### Pull/Merge Requests
| Feature | Status |
|---------|--------|
| Branch compare + diff | Done |
| Review comments | Done (general + inline on diff lines) |
| Approve / request changes | Done |
| Merge (no-ff) | Done |
| Squash merge | Done |
| Merge conflict detection | Done |
| Rebase merge | Done (MVP) |
| PR status checks | Done |

**Tables:** `issues`, `issue_comments`, `labels`, `milestones`, `pull_requests`, `pr_reviews`, `pr_comments`

---

## Phase 3 — Wiki & Code Search (Done)

### Wiki
| Feature | Status |
|---------|--------|
| Per-repo wiki (DB-backed MVP) | Done |
| Markdown pages | Done |
| Revision history | Done |
| Sidebar nav | Done |

### Code Search
| Feature | Status |
|---------|--------|
| Index on push via worker job | Done (MVP) |
| Tantivy full-text index | Done (MVP) |
| Global + repo-scoped search UI | Done (MVP) |

### HTTP/3 (optional)
- [Quiche](https://github.com/cloudflare/quiche) listener for web UI + API
- `tokio-quiche` integration at edge

**Tables:** `wiki_pages`, `wiki_page_revisions`, `code_index_jobs`, `code_search_index_meta`

See [docs/WIKI.md](./WIKI.md), [docs/CODE_SEARCH.md](./CODE_SEARCH.md)

## Phase 4 — CI/CD (Done)

**Goal:** Pipelines on push/PR with status on commits and PRs.

| Component | Approach | Status |
|-----------|----------|--------|
| Pipeline config | `.pertisk-ci.yaml` in repo | Done |
| Scheduler | `pertisk-worker` + API flush on push | Done |
| Runners | `pertisk-runner` shell executor + metrics | Done (MVP) |
| Live logs | Runner streams stdout/stderr during each step | Done |
| Optional jobs | `required: false` skips merge gate | Done |
| Artifacts | Local filesystem (`ARTIFACTS_ROOT`) + download UI | Done |
| Status API | Commit status + PR merge gate | Done |
| PR triggers | Auto-run on PR open + branch push | Done |
| Cancel pipeline / step | API + runner control poll; kills active step | Done |
| Delete pipeline run | DB cascade + artifact files on disk removed | Done |
| Re-run | Same run ID; **all jobs** or **failed only** (`scope: failed`) | Done |
| Fail-fast | On first job failure, skip remaining jobs; runner returns online | Done |
| UI — run list | Table: status, commit, branch, jobs, duration, actions | Done |
| UI — run detail | Pipeline graph, step logs, artifacts, cancel/rerun/delete | Done |
| UI — runners | Host metrics, busy/online, current job | Done |
| Self-build CI | Root pipeline builds `pertisk-gits` + `pertisk-runner` RPMs (`runs-on: docker`) | Done |
| Packaging on CI | `docker cp` into fpm container (CI temp workspaces) | Done |

**MVP:** `on: push`, `on: pull_request`, `jobs`, `steps`, `needs`, `artifacts`, labeled runners

Perf testing: `./scripts/cicd-perf-test.sh` — see [docs/CICD.md](./CICD.md)

**Tables:** `runners`, `pipeline_runs`, `job_runs`, `job_artifacts`, `commit_statuses`, `pipeline_triggers`

**Not in MVP (later):** container-isolated steps, S3 artifacts, matrix builds, caches, per-branch required checks UI

**Secrets (done):** group + repository secrets, `${{ secrets.NAME }}` in pipelines, log masking — see [CICD_SECRETS.md](./CICD_SECRETS.md)

---

## Phase 4.5 — Runner deployment & operations (Done)

**Goal:** Document and ship repeatable ways to install, configure, and run `pertisk-runner` on bare metal, containers, and Kubernetes.

Runners poll the API for jobs (`GET /runner/jobs`), execute shell steps on the host, stream logs, and upload artifacts. Register via UI or `POST /api/v1/runners/register` with **labels** (e.g. `linux`, `docker`) that match `runs-on` in `.pertisk-ci.yaml`.

### Deployment modes

| Mode | Approach | Status |
|------|----------|--------|
| **Linux service (systemd)** | RPM/DEB package — `pertisk-runner` system user, `/etc/pertisk-runner/pertisk-runner.conf`, `systemctl enable --now pertisk-runner` | Done |
| **Remote RPM install** | `make install-runner DEPLOY_HOST=user@host` or `build/deploy-runner-rpm.sh` | Done |
| **Colocated git host** | Set `PERTISK_REPOS_ROOT` = server `REPOS_ROOT` for fast checkout; optional `docker` group for `docker build` steps | Done |
| **Docker image** | OCI image `pertisk-runner` — `make runner-image`; `docker/Dockerfile.runner.release` target `runtime` | Done |
| **Docker Compose** | `deploy/docker-compose.runner.yml` + `make runner-compose-up` | Done |
| **Kubernetes runner** | Helm chart — shell pool **or** GitLab-style per-job pods (`executor: kubernetes`) | Done |

### Configuration (all modes)

| Variable | Purpose |
|----------|---------|
| `PERTISK_RUNNER_TOKEN` | Runner auth token from registration (`ptr_…`) |
| `PERTISK_API_URL` | Pertisk API base (e.g. `https://git.example.com`) |
| `PERTISK_REPOS_ROOT` | Optional — path to bare repos on same host as git server |
| Labels | Declared at registration; jobs match `runs-on` in pipeline YAML |

### Linux service (current production path)

```bash
# Register runner (UI or API) → copy token
sudo vi /etc/pertisk-runner/pertisk-runner.conf   # PERTISK_RUNNER_TOKEN, PERTISK_API_URL
sudo systemctl enable --now pertisk-runner
sudo systemctl status pertisk-runner
```

For `runs-on: docker` jobs: add `pertisk-runner` to the `docker` group and restart (RPM postinstall does this when Docker is present).

### Docker / Compose

```bash
cp deploy/.env.runner.example deploy/.env.runner
make runner-image && make runner-compose-up
```

See [docs/RUNNERS.md](./RUNNERS.md) for `docker run`, Compose, and troubleshooting.

### Kubernetes runner

**Shell pool** (default):

```bash
helm upgrade --install pertisk-runner ./deploy/helm/pertisk-runner \
  --set apiUrl=https://git.example.com --set runnerToken=ptr_...
```

**GitLab-style per-job pods**:

```bash
helm upgrade --install pertisk-runner ./deploy/helm/pertisk-runner \
  -f deploy/helm/pertisk-runner/values-kubernetes.yaml \
  --set apiUrl=https://git.example.com --set runnerToken=ptr_...
```

Register with label `kubernetes`; pipelines use `runs-on: kubernetes`.

HPA / queue-depth autoscale — Phase 7.

Full guide: [docs/RUNNERS.md](./RUNNERS.md)

---

## Phase 4.6 — Deploy environments (Done)

**Goal:** GitLab-style deploy environments with automatic + manual runs, branch selection, and env-scoped secrets.

| Component | Approach | Status |
|-----------|----------|--------|
| Environments | `dev`, `qa`, `uat`, `prd` — inferred from branch/tag or set on manual trigger | Done |
| Job `environment:` + `if: environment == qa` | Per-job deploy targeting in `.pertisk-ci.yaml` | Done |
| Manual run | Pipelines toolbar — branch/tag + environment + **Run pipeline** | Done |
| Manual deploy | Pipeline summary — **Deploy {env}** per path | Done |
| Secrets by env | Group/repo secrets scoped to `all` / `dev` / `qa` / `uat` / `prd` | Done |
| Runner injection | Jobs receive only secrets matching `effective_environment` | Done |

**Example:** `crates/cicd/examples/pertisk-ci-staged.yaml`

**Tables (extended):** `pipeline_runs.target_environment`, `job_runs.effective_environment`, `organization_secrets.environment`, `repository_secrets.environment`

---

## Phase 5 — Container Registry (In progress)

**Goal:** OCI registry per org (`registry.host/org/image:tag`).

| Component | Approach | Status |
|-----------|----------|--------|
| OCI `/v2/*` API | `pertisk-registry` crate — manifest + blob push/pull | Done (MVP) |
| Token auth | `/service/token` — Basic login → scoped Bearer JWT | Done (MVP) |
| Org-scoped images | `{org}/{image}` path; org membership RBAC | Done (MVP) |
| Blob storage | Local FS (`REGISTRY_ROOT`) or S3/MinIO (`REGISTRY_STORAGE=s3`) | Done |
| Gateway route | `/v2/*`, `/service/token` → registry upstream | Done |
| Embedded dev mode | Registry routes merged into `pertisk-api` | Done |
| Registry UI | Group registry page — tags, delete, metadata, git repo link | Done |
| GC worker | Background loop + manual trigger; unreferenced blob cleanup | Done |
| Git repo link | `repository_id` on image; `commit_sha` on tags (push header) | Done |
| Link images to commits UI | Tag commit links when repo linked | Done |

**Deferred:** public anonymous pulls, Helm/K8s chart registry

**Gateway route:** `/v2/*` → `registry` service (or embedded API)

See [docs/REGISTRY.md](./REGISTRY.md)

---

## Phase 6 — SSO/LDAP & Audit Logs (Done)

**Goal:** Enterprise IdP login and org audit trail.

| Component | Status |
|-----------|--------|
| OIDC (Google, Azure AD, Okta) | Done (PKCE, JIT) |
| SAML 2.0 | Done (MVP — enable `SAML_SKIP_SIGNATURE_VERIFY=1` for dev) |
| LDAP bind + group → team mapping | Done |
| JIT user provisioning | Done |
| Append-only `audit_events` | Done |
| Events: login, SSO, permissions, merges | Done |
| Org admin UI: filter, export CSV | Done |
| Provider admin UI (`/settings/auth`) | Done |

See [docs/SSO_AUDIT.md](./SSO_AUDIT.md)

**Tables:** `auth_providers`, `ldap_group_mappings`, `user_external_identities`, `audit_events`

---

## Phase 6.5 — Import from GitHub & GitLab (Done — MVP; phase 2 in progress)

**Goal:** Onboard teams by importing existing projects from GitHub or GitLab without manual `git clone` + push.

### MVP scope

| Component | Approach | Status |
|-----------|----------|--------|
| Import wizard UI | Group → Import — pick source (GitHub / GitLab), list repos, start job | Done |
| Auth | Personal access token (PAT) — list accessible repos; encrypted storage | Done |
| Git mirror | `git clone --mirror` → bare repo under `REPOS_ROOT`; re-import updates mirror | Done |
| Repo metadata | Name, description, default branch, visibility (public/private) | Done |
| Progress + audit | Background processor in `pertisk-api` (+ optional `pertisk-worker`), status in UI, `audit_events` | Done |
| GitHub API fix | `api.github.com` (not `github.com/api/v3`); PAT scope hints in UI | Done |

### Optional (phase 2 of import)

| Component | Notes | Status |
|-----------|-------|--------|
| Issues + labels + milestones | Map via GitHub/GitLab REST API into Pertisk tables; optional checkbox on import | Done (MVP) |
| Pull/merge requests | Import open MRs/PRs (title, body, branches); closed history later | Done (MVP) |
| Wiki pages | Export wiki repo or API → Pertisk wiki (Phase 3) | Deferred |
| CI config | Detect `.gitlab-ci.yml` / GitHub Actions; suggest `.pertisk-ci.yaml` conversion | Done (MVP) |
| Bulk import | Entire GitHub org or GitLab group in one job | Done (MVP) |
| Registry images | Optional mirror of container images to Pertisk registry | Deferred |

### Technical notes

- **Background processor:** `pertisk-api` polls `import_jobs` every 2s; `pertisk-worker` is optional backup
- **Credentials:** Encrypted PAT stored per user/org; never logged
- **Rate limits:** Respect GitHub/GitLab API quotas; resumable mirror on failure
- **Idempotency:** Re-import updates mirror; skip or merge metadata conflicts

### Provider APIs

| Source | List repos | Mirror git | Issues / MRs |
|--------|------------|------------|--------------|
| GitHub | `GET /user/repos`, `GET /orgs/{org}/repos` | `git clone --mirror` or tarball | REST v3 issues + pulls |
| GitLab | `GET /projects` (membership) | `git clone --mirror` or project export | REST v4 issues + merge_requests |

**Tables (new):** `import_jobs`, `import_job_repos` (optional)

See [docs/IMPORT.md](./IMPORT.md)

---

## Phase 7 — Fine-grained Permissions & Kubernetes (Done — MVP)

### Fine-grained Permissions

| Component | Status |
|-----------|--------|
| Branch protection rules (pattern, PR-only, approvals, CI, force-push) | Done (MVP) |
| Enforcement on PR merge | Done |
| Enforcement on Git HTTP push | Done |
| Enforcement on web file commits | Done |
| Branch protection UI (repo settings) | Done |
| Custom roles beyond owner/write/read | Done (MVP) |
| Custom roles UI | Done |
| Teams → repo access with role templates | Done (MVP) |
| Teams UI | Done |
| Deploy keys (SSH, per-repo, read-only default) | Done (MVP) |
| Deploy keys UI (repo settings) | Done |
| Machine users, scoped API tokens | Done (MVP) |
| PAT UI (profile) | Done |
| Machine users UI (group) | Done |

### Kubernetes Integration

| Component | Status |
|-----------|--------|
| Helm chart for CI runners | Done (Phase 4.5) |
| Helm chart for platform (`pertisk-gits`) | Done (MVP) |
| K8s deployment guide | Done — [KUBERNETES.md](./KUBERNETES.md) |
| HPA / queue-depth autoscale for runners | Done (MVP — metrics endpoint + Helm external metric) |
| Optional GitOps webhooks (Argo CD / Flux) | Done (MVP) |

**Deferred:** rebase merge, catalog API, public registry pulls, Helm/K8s chart registry

**Tables (new):** `branch_protection_rules`, `repository_deploy_keys`, `organization_custom_roles`, `teams`, `team_members`, `team_repository_permissions`, extended `api_tokens`, `gitops_webhooks`

---

## Phase 8 — Platform polish (Next)

| Component | Status |
|-----------|--------|
| Rebase merge on PRs | Done (MVP) |
| Registry catalog API | Done (MVP — `/v2/_catalog`, org-scoped catalog) |
| Public anonymous registry pulls | Planned |
| Import wiki pages | Planned |
| Blame / line history in file browser | Planned |

---

## Feature → Phase Map

| Feature | Phase |
|---------|-------|
| Git Repository Hosting | 1 |
| Issue Tracking | 2 |
| Pull/Merge Requests | 2 |
| Wiki | 3 |
| Code Search | 3 |
| HTTP/3 (Quiche) | 3 |
| CI/CD | 4 |
| Deploy environments (dev/qa/uat/prd) | 4.6 |
| Runner deployment (systemd / Docker / K8s) | 4.5 |
| Built-in Container Registry | 5 |
| SSO/LDAP Integration | 6 |
| Audit Logs | 6 |
| Import from GitHub / GitLab | 6.5 |
| Fine-grained Permissions | 7 |
| Kubernetes Integration | 7 |
| Platform polish | 8 |

---

## MVP Definition (after Phase 2)

- Create org/repo, push/pull via HTTPS + SSH
- Issues with labels and comments
- PRs with review and merge
- Basic RBAC (org/repo roles)
- Public/private repos

---

## Timeline Estimate

| Milestone | Duration | Cumulative |
|-----------|----------|------------|
| MVP (Git + issues + PRs) | ~4–5 months | Phase 0–2 |
| Collaboration platform | +2 months | Phase 3 |
| DevOps platform | +3–4 months | Phase 4–5 |
| Enterprise | +3–4 months | Phase 6–7 |

**Team of 2–3:** ~12–18 months to GitLab-lite  
**Solo:** 2+ years for full feature set

---

## Repository Layout

```
pertisk-gits/
├── crates/
│   ├── domain/           # Shared models
│   ├── api/              # axum REST API
│   ├── gateway/          # Pingora reverse proxy
│   ├── git/              # Phase 1 (git-http, git-ssh)
│   ├── cicd/             # Phase 4 pipeline engine
│   ├── runner/           # Phase 4 CI runner
│   ├── worker/           # Phase 4 scheduler + Phase 6.5 import jobs
│   └── registry/         # Phase 5 OCI container registry
│   └── search/           # Phase 3 Tantivy code search
├── web/                  # React app
├── migrations/           # SQLx migrations
├── deploy/               # Docker Compose, Helm
│   └── helm/
│       ├── pertisk-gits/     # Platform chart (Phase 7)
│       └── pertisk-runner/   # CI runner chart
└── docs/
    └── PHASES.md         # This file
```
