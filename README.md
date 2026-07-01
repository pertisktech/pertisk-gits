# Pertisk Gits

Git platform built with Rust, React, and PostgreSQL.

## Quick Start

### Using Make (recommended)

```bash
cp .env.example .env

# Dev — single port :8080 (Postgres + API + built web UI)
make dev

# Dev — hot-reload UI on :5173, API on :8080
make dev-vite

# Stop dev processes
make dev-stop
```

Requires: Docker, `cargo-watch` (`cargo install cargo-watch`).

### Manual start

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

## Packaging & deploy

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for reverse proxy, gateway, and HTTP/3 setup.

Like [pertisk-proxy](https://github.com/pertisktech/pertisk-proxy), packages are built with Docker cross-compile + fpm (DEB/RPM).

```bash
# Build Linux package (amd64 DEB + RPM + tarball → release/)
make build VERSION=0.1.0

# Build + deploy (auto-detect deb/rpm on remote host)
make deploy DEPLOY_HOST=nat@103.117.150.228 VERSION=0.1.0

# Or explicit package manager
make deploy-rpm DEPLOY_HOST=nat@103.117.150.228 VERSION=0.1.0
make deploy-deb DEPLOY_HOST=nat@103.117.150.228 VERSION=0.1.0

# Build only (both architectures)
make package VERSION=0.1.0

# Deploy existing package (skip rebuild)
make deploy DEPLOY_HOST=user@host VERSION=0.1.0 PACKAGE_BUILD=0
```

Installed service: `pertisk-gits` on port **8080** (UI + API + Git HTTP).

Config: `/etc/pertisk-gits/pertisk-gits.conf` — set `DATABASE_URL`, `JWT_SECRET`, and `GIT_PUBLIC_BASE_URL`, then `sudo systemctl restart pertisk-gits`.

## API Endpoints (Phase 0)

| Method | Path | Auth |
|--------|------|------|
| GET | `/health` | No — readiness (includes DB check) |
| GET | `/health/live` | No — liveness |
| GET | `/api/v1/health` | No — same as `/health` |
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
- **HTTP/3 (optional):** `pertisk-h3-gateway` — see [docs/HTTP3.md](docs/HTTP3.md)
