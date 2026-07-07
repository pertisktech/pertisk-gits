# Import from GitHub, GitLab & Pertisk Gits

Onboard teams by mirroring existing projects into Pertisk Gits without manual `git clone` + push.

## Overview

Group owners and admins can import repositories from **GitHub**, **GitLab** (including self-hosted), or **another Pertisk Gits server** via **Group → Import** in the web UI.

MVP scope:

- Personal access token (PAT) authentication
- List accessible repositories
- `git clone --mirror` into bare repos under `REPOS_ROOT`
- Repository metadata: name, description, default branch, visibility
- Optional **issues, labels, milestones** and **open pull/merge requests** (checkboxes when starting import)
- Optional **wiki pages** — GitHub wiki git mirror (`.wiki.git`) or GitLab wiki REST API
- **Bulk import** — filter by GitHub org or GitLab group, select all; up to 500 repos per job by default (configurable via `IMPORT_MAX_REPOS_PER_JOB`; the UI splits larger selections into multiple jobs)
- **CI config migration** — Pipelines tab detects `.gitlab-ci.yml` / `.github/workflows/*` and suggests `.pertisk-ci.yaml`
- Background job with progress in the UI
- Audit log entries for import start and completion

Not included yet: issue comments, closed/merged PR history, registry image mirror.

## CI config migration

After import (or on any repo without `.pertisk-ci.yaml`), open **Project → Pipelines**. If the default branch contains `.gitlab-ci.yml` or `.github/workflows/*.yml`, Pertisk suggests a converted `.pertisk-ci.yaml` with copy-to-clipboard.

API: `GET /organizations/{org}/repositories/{repo}/pipelines/migrate?ref=main`

Conversion is best-effort — review `runs-on` labels, triggers, and GitHub Action steps before committing.

## Requirements

- **pertisk-api** — REST endpoints and background import job processor
- **pertisk-worker** — optional backup poller for import jobs and CI triggers
- **git** — available on the worker host (`git clone --mirror`)
- **SECRETS_ENCRYPTION_KEY** (or `JWT_SECRET` in dev) — encrypts stored PATs (same key as CI secrets)

## Personal access tokens

### GitHub

Create a classic or fine-grained PAT:

- **Classic PAT:** enable the **`repo`** scope (required for private repositories). For bulk org import, also enable **`read:org`**.
- **Fine-grained PAT:** grant **Read** access to **Contents** and **Metadata** for the repositories you want to import. Grant organization access to list org repositories.

Pertisk calls the GitHub REST API at `https://api.github.com` (not `github.com/api/v3`). For **GitHub Enterprise Server**, set your instance URL in the import wizard (e.g. `https://github.mycompany.com`).

### GitLab

Create a PAT with **`read_api`** and **`read_repository`** scopes.

For self-hosted GitLab, enter the instance URL (e.g. `https://git.example.com`) in the import wizard.

### Pertisk Gits (another server)

Use this to mirror git repositories from **Server A** into **Server B** (git only — no issues, PRs, or wiki).

1. On **Server A**, create an **API token** for your user (Profile → API tokens) with access to the groups/repos you need.
2. On **Server B**, open **Group → Import → Pertisk Gits**.
3. Enter Server A’s public URL (e.g. `https://git-a.example.com`) and the `pgs_…` token.
4. Select the source group and repositories, then start the import. Selecting a parent group includes repositories in all subgroups under it.

Server B must reach Server A over HTTPS (or set `IMPORT_TLS_INSECURE=true` for private CA in dev). Git clone uses the same API token via smart HTTP (`x-access-token`).

## API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/import/credentials` | List your saved import connections (all groups) |
| `GET` | `/organizations/{org}/import/credentials` | Same list (requires group admin) |
| `POST` | `/organizations/{org}/import/credentials` | Save or update encrypted PAT |
| `DELETE` | `/organizations/{org}/import/credentials/{id}` | Remove saved credential |
| `POST` | `/organizations/{org}/import/discover` | List remote repos and orgs/groups (`credential_id`; optional `namespace` + `namespace_kind`) |
| `POST` | `/organizations/{org}/import/jobs` | Start import job (`import_issues`, `import_pull_requests`, `import_wiki` optional; up to `IMPORT_MAX_REPOS_PER_JOB` repos, default 500) |
| `GET` | `/organizations/{org}/import/jobs` | List recent jobs |
| `GET` | `/organizations/{org}/import/jobs/{id}` | Job detail with per-repo status |

## Job lifecycle

```
pending → mirroring → metadata (optional) → done | failed
```

The background processor (in `pertisk-api`, optional `pertisk-worker` backup):

1. Claims pending jobs
2. Creates (or reuses) Pertisk repository records
3. Runs `git clone --mirror` (or `git remote update` on re-import)
4. Sets `default_branch` from the mirrored bare repo
5. When enabled: imports labels, milestones, issues, and/or **open** pull/merge requests (preserves numbers; skips closed/merged PRs)
6. Writes audit events

Re-importing the same target slug updates the mirror in place (`on_conflict: override`). Saved tokens are per user and GitHub/GitLab instance — reuse them in any group.

## Database

- `import_credentials` — encrypted PAT per user/provider/instance (shared across groups)
- `import_jobs` — background job header
- `import_job_repos` — per-repository import state

Migration: `migrations/20250709100000_phase65_import.sql`, `migrations/20250710100000_import_issues.sql`, `migrations/20250711100000_import_pull_requests.sql`

## Security

- PATs are encrypted at rest (AES-256-GCM); never returned by the API after save
- PATs are never written to logs
- Only group **owners** and **admins** can use import endpoints

## Troubleshooting

| Symptom | Check |
|---------|--------|
| Job stays `pending` | Restart `pertisk-gits` after upgrade (API runs the import processor). Also check `sudo systemctl status pertisk-worker` if you use the separate worker service. |
| `git clone --mirror failed` | Token scopes, network egress, private repo access |
| Import **done** but repo **empty** | Source project has no commits on disk (UI shell only), or source returned an empty bare repo. On the **source** server: `git -C REPOS_ROOT/.../repo.git rev-list --all --max-count=1` must print a SHA. Re-import after pushing to source. |
| `source repository has no commits` | Same as above — import now fails instead of creating an empty mirror |
| `invalid GitHub/GitLab token` | Token expired or wrong instance URL for GitLab |
| `GitHub API request to … failed` | Server cannot reach GitHub (firewall/proxy), bad instance URL, or TLS trust issue on self-hosted GitHub — set `IMPORT_TLS_INSECURE=true` only for dev/GHE with a private CA |
| Slug conflict | Target slug already exists in the group — pick a different name or delete the existing repo |
