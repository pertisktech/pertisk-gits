# Pertisk Gits

Self-hosted Git platform built with Rust, React, and PostgreSQL.

## Quick Start

### 1. Start infrastructure

```bash
docker compose -f deploy/docker-compose.yml up -d
```

### 2. Configure environment

```bash
cp .env.example .env
```

### 3. Run services

Terminal 1 — API:

```bash
cargo run -p pertisk-api
```

Terminal 2 — Gateway (clone URLs use port 8080):

```bash
cargo run -p pertisk-gateway
```

Terminal 3 — Web UI:

```bash
cd web && npm run dev
```

Git Smart HTTP is built into the API — you do **not** need a separate git-http process for local dev.

Optional standalone git server (production scale-out):

```bash
cargo run -p pertisk-git --bin pertisk-git-http
```

### Clone & push

1. Open a project in the UI → **Clone** section shows the HTTP URL
2. Clone: `git clone http://localhost:8080/{group}/{project}.git`
3. Push: use your username + account password when Git prompts for credentials

Private projects require authentication for clone and push.

## API Endpoints (Phase 0)

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/v1/health` | No |
| POST | `/api/v1/auth/register` | No |
| POST | `/api/v1/auth/login` | No |
| GET | `/api/v1/me` | Bearer JWT |
| GET/POST | `/api/v1/organizations` | Bearer JWT |
| GET/POST | `/api/v1/organizations/{slug}/repositories` | Bearer JWT |

## Development Phases

See [docs/PHASES.md](docs/PHASES.md) for the full roadmap.

## Stack

- **Gateway:** [Pingora](https://github.com/cloudflare/pingora)
- **API:** axum + sqlx + PostgreSQL
- **Frontend:** React + TypeScript + Vite
- **HTTP/3 (later):** [Quiche](https://github.com/cloudflare/quiche)
