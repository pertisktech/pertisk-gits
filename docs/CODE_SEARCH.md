# Code Search

Full-text search across repository source files (Phase 3 MVP).

## How it works

1. On **branch push**, the API enqueues a `code_index_jobs` row
2. Background processor (`pertisk-api` or `pertisk-worker`) indexes text files from the pushed commit
3. Documents are stored in a shared **Tantivy** index under `SEARCH_INDEX_ROOT` (default `data/search`)
4. Search queries filter results by repositories the caller can read

Indexed file types include common source and config extensions (`.rs`, `.ts`, `.py`, `.md`, etc.). Skips `node_modules/`, lockfiles, binaries, and files over 256 KiB.

## UI

- **Global search** (top bar) — groups, repos, and code hits (2+ characters)
- **Project → Code** — repo-scoped search panel with index status

Click a code hit to open the file in the browser (`?file=path`).

## API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/search/code?q=…&limit=20` | Global search (optional auth; public repos when anonymous) |
| `GET` | `/organizations/{org}/repositories/{repo}/search/code?q=…` | Repo-scoped search |
| `GET` | `/organizations/{org}/repositories/{repo}/search/status` | Index metadata for repo |

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `SEARCH_INDEX_ROOT` | `data/search` | Tantivy index directory |

## Database

Migration: `migrations/20250714100000_phase3_code_search.sql`

- `code_index_jobs` — queue on push
- `code_search_index_meta` — last indexed commit per repo

## Not in MVP

- Search issues/wiki/PRs in the same index
- Meilisearch remote cluster
- Incremental per-file updates (full repo re-index on push)
- Symbol / regex search
