# Import from GitHub & GitLab

Onboard teams by mirroring existing projects into Pertisk Gits without manual `git clone` + push.

## Overview

Group owners and admins can import repositories from **GitHub** or **GitLab** (including self-hosted GitLab) via **Group → Import** in the web UI.

MVP scope:

- Personal access token (PAT) authentication
- List accessible repositories
- `git clone --mirror` into bare repos under `REPOS_ROOT`
- Repository metadata: name, description, default branch, visibility
- Background job with progress in the UI
- Audit log entries for import start and completion

Not included yet: issues, labels, milestones, merge requests, wiki, CI config conversion, bulk org/group import, registry image mirror.

## Requirements

- **pertisk-api** — REST endpoints and background import job processor
- **pertisk-worker** — optional backup poller for import jobs and CI triggers
- **git** — available on the worker host (`git clone --mirror`)
- **SECRETS_ENCRYPTION_KEY** (or `JWT_SECRET` in dev) — encrypts stored PATs (same key as CI secrets)

## Personal access tokens

### GitHub

Create a classic or fine-grained PAT:

- **Classic PAT:** enable the **`repo`** scope (required for private repositories).
- **Fine-grained PAT:** grant **Read** access to **Contents** and **Metadata** for the repositories you want to import.

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
| `POST` | `/organizations/{org}/import/discover` | List remote repos (`credential_id` or inline token) |
| `POST` | `/organizations/{org}/import/jobs` | Start import job (up to 50 repos) |
| `GET` | `/organizations/{org}/import/jobs` | List recent jobs |
| `GET` | `/organizations/{org}/import/jobs/{id}` | Job detail with per-repo status |

## Job lifecycle

```
pending → mirroring → done | failed
```

The worker:

1. Claims pending jobs
2. Creates (or reuses) Pertisk repository records
3. Runs `git clone --mirror` (or `git remote update` on re-import)
4. Sets `default_branch` from the mirrored bare repo
5. Writes audit events

Re-importing the same target slug updates the mirror in place.

## Database

- `import_credentials` — encrypted PAT per user/org/provider/base URL
- `import_jobs` — background job header
- `import_job_repos` — per-repository import state

Migration: `migrations/20250709100000_phase65_import.sql`

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
