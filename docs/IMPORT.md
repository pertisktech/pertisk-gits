# Import from GitHub & GitLab

Onboard teams by mirroring existing projects into Pertisk Gits without manual `git clone` + push.

## Overview

Group owners and admins can import repositories from **GitHub** or **GitLab** (including self-hosted GitLab) via **Group → Import** in the web UI.

MVP scope:

- Personal access token (PAT) authentication
- List accessible repositories
- `git clone --mirror` into bare repos under `REPOS_ROOT`
- Repository metadata: name, description, default branch, visibility
- Optional **issues, labels, milestones** and **open pull/merge requests** (checkboxes when starting import)
- **Bulk import** — filter by GitHub org or GitLab group, select all, import up to 200 repos per job
- **CI config migration** — Pipelines tab detects `.gitlab-ci.yml` / `.github/workflows/*` and suggests `.pertisk-ci.yaml`
- Background job with progress in the UI
- Audit log entries for import start and completion

Not included yet: issue comments, closed/merged PR history, wiki, registry image mirror.

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

## API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/organizations/{org}/import/credentials` | List saved credentials (no token value) |
| `POST` | `/organizations/{org}/import/credentials` | Save or update encrypted PAT |
| `DELETE` | `/organizations/{org}/import/credentials/{id}` | Remove saved credential |
| `POST` | `/organizations/{org}/import/discover` | List remote repos and orgs/groups (`credential_id`; optional `namespace` + `namespace_kind`) |
| `POST` | `/organizations/{org}/import/jobs` | Start import job (`import_issues`, `import_pull_requests` optional; up to 200 repos) |
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

Re-importing the same target slug updates the mirror in place.

## Database

- `import_credentials` — encrypted PAT per user/org/provider/base URL
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
| `invalid GitHub/GitLab token` | Token expired or wrong instance URL for GitLab |
| Slug conflict | Target slug already exists in the group — pick a different name or delete the existing repo |
