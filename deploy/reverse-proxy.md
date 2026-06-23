# Reverse proxy for Pertisk Gits (single domain)

`pertisk-gits` serves **everything** on one port (default `8080`):

| Path | Handler |
|------|---------|
| `/api/v1/*` | REST API |
| `/{org}/{repo}.git/*` | Git Smart HTTP |
| `/*` | React SPA (`WEB_DIST`) |

The reverse proxy must forward **all** requests for your Git host to `pertisk-gits` — not only `/api/v1` or `*.git`.

## Server config

Edit `/etc/pertisk-gits/pertisk-gits.conf`:

```ini
API_PORT=8080
DATABASE_URL=postgres://pertisk:SECRET@127.0.0.1:5432/pertisk_gits
JWT_SECRET=<long-random-secret>
REPOS_ROOT=/var/lib/pertisk-gits/repos
GIT_PUBLIC_BASE_URL=https://gitdev.cloud.pertisk.com
WEB_DIST=/usr/share/pertisk-gits/web
```

```bash
sudo systemctl restart pertisk-gits
```

Verify SPA locally on the server:

```bash
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8080/groups/node-js/projects/node-express
# expect 200 (index.html)
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

---

## Caddy

```caddy
gitdev.cloud.pertisk.com {
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
        client_max_body_size 0;  # large git pushes
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
