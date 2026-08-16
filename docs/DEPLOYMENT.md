# Deployment

How to run Pertisk Gits in production: packaged all-in-one behind a reverse proxy, or split services behind the Pingora gateway.

| Scenario | Pattern |
|----------|---------|
| Single-server package install | Reverse proxy → `pertisk-gits` on `:8080` |
| Local dev / scale-out | `pertisk-gateway` → separate API, git-http, registry upstreams |
| HTTP/3 at the edge | `pertisk-h3-gateway` → gateway or API — see [HTTP3.md](./HTTP3.md) |
| Kubernetes | Ingress → all-in-one API — see [KUBERNETES.md](./KUBERNETES.md) |

---

## Packaging

Like [pertisk-proxy](https://github.com/pertisktech/pertisk-proxy), packages are built with Docker cross-compile + fpm (DEB/RPM).

```bash
# Build Linux package (amd64 DEB + RPM + tarball → release/)
VERSION=0.1.0 ./scripts/build.sh
# or: make package VERSION=0.1.0

# Deploy to hosts listed in scripts/hosts.local.sh (gitignored)
cp scripts/hosts.local.example.sh scripts/hosts.local.sh   # once
VERSION=0.1.0 ./scripts/deploy.sh

# Or a single host via Make
make deploy DEPLOY_HOST=user@host VERSION=0.1.0
make deploy-rpm DEPLOY_HOST=user@host VERSION=0.1.0
make deploy-deb DEPLOY_HOST=user@host VERSION=0.1.0

# Deploy existing package (skip rebuild)
make deploy DEPLOY_HOST=user@host VERSION=0.1.0 PACKAGE_BUILD=0
```

Installed service: **`pertisk-gits`** on port **8080** (UI + API + Git HTTP + embedded registry).

Config: `/etc/pertisk-gits/pertisk-gits.conf` — set `DATABASE_URL`, `JWT_SECRET`, and `GIT_PUBLIC_BASE_URL`, then:

```bash
sudo systemctl restart pertisk-gits
```

---

## All-in-one behind a reverse proxy

The packaged binary serves **everything** on one port (default `8080`):

| Path | Handler |
|------|---------|
| `/api/v1/*` | REST API |
| `/health`, `/health/live` | Health probes (no auth) |
| `/{org}/{repo}.git/*` | Git Smart HTTP |
| `/v2/*`, `/service/token` | OCI container registry |
| `/*` | React SPA (`WEB_DIST`) |

TLS terminates at the reverse proxy. Forward **all** requests for your Git host to `pertisk-gits` — not only `/api/v1` or `*.git`.

### Server config

Example `/etc/pertisk-gits/pertisk-gits.conf`:

```ini
API_PORT=8080
DATABASE_URL=postgres://pertisk:SECRET@127.0.0.1:5432/pertisk_gits
JWT_SECRET=<long-random-secret>
REPOS_ROOT=/var/lib/pertisk-gits/repos
GIT_PUBLIC_BASE_URL=https://git.example.com
GIT_SSH_HOST=0.0.0.0
GIT_SSH_PORT=2222
GIT_SSH_PUBLIC_HOST=git.example.com
GIT_SSH_HOST_KEY_PATH=/var/lib/pertisk-gits/ssh_host_key
WEB_DIST=/usr/share/pertisk-gits/web
```

**Git SSH** uses a separate TCP listener (`GIT_SSH_PORT`, default `2222`). It does **not** go through the HTTPS reverse proxy — open that port on the firewall.

### Health checks

```bash
# Readiness — verifies PostgreSQL connectivity (503 if DB is down)
curl -fsS http://127.0.0.1:8080/health

# Liveness — process is up (always 200 when the server is running)
curl -fsS http://127.0.0.1:8080/health/live
```

Verify the SPA locally:

```bash
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8080/groups/my-group/projects/my-project
# expect 200 (index.html)
```

If local returns **200** but HTTPS still **404**, fix the reverse proxy routing.

### Reverse proxy rules

1. **One upstream for the whole host** — route `/` (prefix) to `127.0.0.1:8080`. Do not split UI and API into different upstreams.
2. **Large request bodies** — registry pushes and large git pushes need unlimited or ≥ 5 GiB body limits at the proxy. Without this, `docker push` fails with `413 Payload Too Large`.
3. **Forwarded headers** — set `Host`, `X-Forwarded-Proto`, and `X-Forwarded-For` so the app knows the public URL.

Proxy-specific examples (pertisk-proxy, nginx ingress, Caddy, nginx): [deploy/reverse-proxy.md](../deploy/reverse-proxy.md).

### Common mistake

```caddy
# WRONG — UI routes like /groups/... return 404
handle /api/v1/* { reverse_proxy 127.0.0.1:8080 }
handle /*.git* { reverse_proxy 127.0.0.1:8080 }
# missing: all other paths
```

Use one `reverse_proxy` to `:8080` for the whole host instead.

---

## Pingora gateway (`pertisk-gateway`)

For local dev or scale-out, **`pertisk-gateway`** is the public HTTP entry point. It routes by path to separate upstreams.

```
Internet → pertisk-gateway :8080
              ├─ API_UPSTREAM      (REST API + SPA + /health)
              ├─ GIT_UPSTREAM      (paths containing .git)
              └─ REGISTRY_UPSTREAM (/v2/*, /service/token)
```

The gateway answers `/health` directly with `200 ok` without hitting a backend.

### Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `GATEWAY_HOST` | `0.0.0.0` | Bind address |
| `GATEWAY_PORT` | `8080` | Public listen port |
| `API_UPSTREAM` | `127.0.0.1:8081` | API + web UI |
| `GIT_UPSTREAM` | `127.0.0.1:8082` | Git Smart HTTP (`pertisk-git-http`) |
| `REGISTRY_UPSTREAM` | `127.0.0.1:8083` | OCI registry (`pertisk-registry`) |

### Dev (gateway + API)

Terminal 1 — API (set `API_PORT=8081` or use defaults from `.env`):

```bash
cargo run -p pertisk-api
```

Terminal 2 — Gateway (clone URLs use port 8080):

```bash
cargo run -p pertisk-gateway
```

Git Smart HTTP is built into the API for local dev — a separate `pertisk-git-http` process is optional. For embedded registry (default), set `REGISTRY_EMBEDDED=1` so `/v2/*` is served by the API; point `REGISTRY_UPSTREAM` at the same port or run a standalone registry for split mode. See [REGISTRY.md](./REGISTRY.md).

### Production with gateway

Place a reverse proxy (or `pertisk-h3-gateway`) in front of `pertisk-gateway` on `:8080`. Run backends on their upstream ports and set env vars to match.

Optional standalone git server for scale-out:

```bash
cargo run -p pertisk-git --bin pertisk-git-http
```

---

## HTTP/3 edge (optional)

**`pertisk-h3-gateway`** adds QUIC/HTTP/3 on top of the TCP gateway or API:

```
Client → pertisk-h3-gateway :8443 --HTTP/1.1--> pertisk-gateway :8080
                                      └──────────> pertisk-api :8080
```

Production: run **h3-gateway** beside **pertisk-gateway** on the same host; set `GATEWAY_HTTP_UPSTREAM=http://127.0.0.1:8080`. Open **UDP and TCP** on `GATEWAY_H3_PORT` (default `8443`). Use real TLS certificates (HTTP/3 requires TLS 1.3).

Full configuration and quick start: [HTTP3.md](./HTTP3.md).

---

## Architecture overview

```
┌─────────────────────────────────────────────────────────┐
│  Simple production (DEB/RPM package)                    │
│                                                         │
│  Internet → reverse proxy (TLS) → pertisk-gits :8080    │
│           → Git SSH :2222 (direct, not via proxy)       │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  Gateway / scale-out                                    │
│                                                         │
│  Internet → reverse proxy OR h3-gateway :8443         │
│          → pertisk-gateway :8080                        │
│              ├─ API_UPSTREAM                            │
│              ├─ GIT_UPSTREAM                            │
│              └─ REGISTRY_UPSTREAM                       │
└─────────────────────────────────────────────────────────┘
```

---

## Related docs

- [deploy/reverse-proxy.md](../deploy/reverse-proxy.md) — nginx, Caddy, pertisk-proxy, ingress examples
- [KUBERNETES.md](./KUBERNETES.md) — Helm charts (Ingress TLS, no Pingora in chart)
- [HTTP3.md](./HTTP3.md) — QUIC edge gateway
- [REGISTRY.md](./REGISTRY.md) — embedded vs standalone registry
- [RUNNERS.md](./RUNNERS.md) — CI runners and SSH
- [BACKUP.md](./BACKUP.md) — server-side backup/restore CLI (GitLab-style)
