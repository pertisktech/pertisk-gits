# Reverse proxy for Pertisk Gits (single domain)

`pertisk-gits` serves **everything** on one port (default `8080`):

| Path | Handler |
|------|---------|
| `/api/v1/*` | REST API |
| `/health`, `/health/live` | Health probes (no auth) |
| `/{org}/{repo}.git/*` | Git Smart HTTP |
| `/v2/*`, `/service/token` | OCI container registry |
| `/*` | React SPA (`WEB_DIST`) |

The reverse proxy must forward **all** requests for your Git host to `pertisk-gits` — not only `/api/v1` or `*.git`.

**Docker registry pushes** send multi‑MB layer blobs on `/v2/.../blobs/uploads/...`. If the proxy or ingress caps request body size (common defaults: **1–10 MiB**), pushes fail with **`413 Payload Too Large`**. Set **unlimited** or **≥ 5 GiB** on the site / ingress (see below).

## Server config

Edit `/etc/pertisk-gits/pertisk-gits.conf`:

```ini
API_PORT=8080
DATABASE_URL=postgres://pertisk:SECRET@127.0.0.1:5432/pertisk_gits
JWT_SECRET=<long-random-secret>
REPOS_ROOT=/var/lib/pertisk-gits/repos
GIT_PUBLIC_BASE_URL=https://gitdev.cloud.pertisk.com
GIT_SSH_HOST=0.0.0.0
GIT_SSH_PORT=2222
GIT_SSH_PUBLIC_HOST=gitdev.cloud.pertisk.com
GIT_SSH_HOST_KEY_PATH=/var/lib/pertisk-gits/ssh_host_key
WEB_DIST=/usr/share/pertisk-gits/web
```

Open **TCP port 2222** (or your `GIT_SSH_PORT`) on the firewall. Git over SSH uses a separate listener from HTTP — it does not go through the HTTPS reverse proxy.

```bash
sudo systemctl restart pertisk-gits
```

Verify SPA locally on the server:

```bash
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8080/groups/node-js/projects/node-express
# expect 200 (index.html)
```

Health checks (load balancers, monitoring):

```bash
# Readiness — verifies PostgreSQL connectivity (503 if DB is down)
curl -fsS http://127.0.0.1:8080/health

# Liveness — process is up (always 200 when the server is running)
curl -fsS http://127.0.0.1:8080/health/live
```

If that returns **200** but HTTPS still **404**, fix the reverse proxy below.

---

## pertisk-proxy (same host)

In the **pertisk-proxy admin UI** → **Sites** → add:

| Field | Value |
|-------|--------|
| Host | `gitdev.cloud.pertisk.com` |
| Upstream | `127.0.0.1:8080` |
| Path | `/` (prefix — all paths) |

Enable TLS (ACME) for that host. Do **not** split UI and API into different upstreams.

**Registry pushes:** In site settings, set **max request body size** to **0** (unlimited) or at least **5 GiB**. Without this, `docker push` fails around 1–10 MiB with `413 Payload Too Large`.

---

## Kubernetes / nginx ingress

If `gitdev.cloud.pertisk.com` is routed through nginx ingress (not pertisk-proxy on the same host), add annotations:

```yaml
metadata:
  annotations:
    nginx.ingress.kubernetes.io/proxy-body-size: "0"
    nginx.ingress.kubernetes.io/proxy-request-buffering: "off"
```

`proxy-body-size: "0"` disables the body limit. Reload the ingress controller after applying.

---

## Caddy

```caddy
gitdev.cloud.pertisk.com {
    request_body {
        max_size 5GB
    }
    reverse_proxy 127.0.0.1:8080
}
```

---

## Nginx

```nginx
server {
    listen 443 ssl;
    server_name gitdev.cloud.pertisk.com;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        client_max_body_size 0;  # git pushes + docker registry layers
        proxy_request_buffering off;
    }
}
```

---

## Common mistake

```caddy
# WRONG — UI routes like /groups/... return 404
handle /api/v1/* { reverse_proxy 127.0.0.1:8080 }
handle /*.git* { reverse_proxy 127.0.0.1:8080 }
# missing: all other paths
```

Use one `reverse_proxy` to `:8080` for the whole host instead.
