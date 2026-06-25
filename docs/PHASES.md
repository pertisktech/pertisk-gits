# Pertisk Gits — Development Phases

Self-hosted Git platform (GitHub / GitLab / Gitea alternative) built with **Rust**, **React**, and **PostgreSQL**.

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
| Rebase merge | Phase 7 |
| PR status checks | Done |

**Tables:** `issues`, `issue_comments`, `labels`, `milestones`, `pull_requests`, `pr_reviews`, `pr_comments`

---

## Phase 3 — Wiki & Code Search

### Wiki
- Per-repo wiki (Git-backed or DB-backed)
- Markdown pages, history, sidebar nav

### Code Search
- Index on push via worker job
- Tantivy or Meilisearch
- Global + repo-scoped search UI

### HTTP/3 (optional)
- [Quiche](https://github.com/cloudflare/quiche) listener for web UI + API
- `tokio-quiche` integration at edge

---

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

**MVP:** `on: push`, `on: pull_request`, `jobs`, `steps`, `needs`, `artifacts`, self-hosted runners

Perf testing: `./scripts/cicd-perf-test.sh` — see [docs/CICD.md](./CICD.md)

**Tables:** `runners`, `pipeline_runs`, `job_runs`, `job_artifacts`, `commit_statuses`, `pipeline_triggers`

**Not in MVP (later):** container-isolated steps, S3 artifacts, matrix builds, caches, secrets, per-branch required checks UI

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

**Deferred:** catalog API, public pulls, Helm/K8s chart registry

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

## Phase 7 — Fine-grained Permissions & Kubernetes

### Fine-grained Permissions
- Custom roles beyond owner/write/read
- Branch protection, required reviews, required CI
- Team → repo access with role templates
- Deploy keys, machine users, scoped API tokens

### Kubernetes Integration
- Helm chart for gateway + API + workers
- K8s-based CI runners
- Optional GitOps webhooks (Argo CD / Flux)

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
| Built-in Container Registry | 5 |
| SSO/LDAP Integration | 6 |
| Audit Logs | 6 |
| Fine-grained Permissions | 7 |
| Kubernetes Integration | 7 |

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
│   ├── runner/           # Phase 4 self-hosted runner
│   ├── worker/           # Phase 4 scheduler
│   └── registry/         # Phase 5 OCI container registry
├── web/                  # React app
├── migrations/           # SQLx migrations
├── deploy/               # Docker Compose, Helm
└── docs/
    └── PHASES.md         # This file
```
