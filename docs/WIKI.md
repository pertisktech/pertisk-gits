# Wiki

Per-repository documentation stored in PostgreSQL (Phase 3 MVP).

## Features

- **Markdown pages** — title + body with `@mentions` and cross-links like issues
- **Sidebar navigation** — ordered page list on the Wiki tab
- **Revision history** — each save appends a revision; view last 50 per page
- **Public read** — public repos allow anonymous wiki read (same as issues)

## UI

Open **Project → Wiki** (`/groups/{org}/projects/{repo}/wiki`).

- **New page** — creates a page with an auto-generated slug from the title
- **Edit / Save** — updates content and records a revision
- **History** — lists recent revisions with author and timestamp
- **Delete** — removes page and all revisions (requires write access)

Default landing redirects to the `home` page when present, otherwise the first page.

## API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/organizations/{org}/repositories/{repo}/wiki/pages` | List pages (sidebar) |
| `GET` | `/organizations/{org}/repositories/{repo}/wiki/pages/{slug}` | Page detail |
| `POST` | `/organizations/{org}/repositories/{repo}/wiki/pages` | Create page |
| `PATCH` | `/organizations/{org}/repositories/{repo}/wiki/pages/{slug}` | Update page |
| `DELETE` | `/organizations/{org}/repositories/{repo}/wiki/pages/{slug}` | Delete page |
| `GET` | `/organizations/{org}/repositories/{repo}/wiki/pages/{slug}/revisions` | List revisions |
| `GET` | `/organizations/{org}/repositories/{repo}/wiki/pages/{slug}/revisions/{id}` | Revision detail |

## Database

Migration: `migrations/20250713100000_phase3_wiki.sql`

- `wiki_pages` — current page content and sidebar metadata (`position`, optional `parent_slug`)
- `wiki_page_revisions` — append-only history

## Not in MVP

- Git-backed wiki export/import
- Wiki import from GitHub/GitLab (Phase 6.5)
- Page move/rename (slug changes)
- Diff between revisions
