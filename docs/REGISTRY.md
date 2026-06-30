# Phase 5 — Container Registry

OCI Distribution Spec v2 registry scoped per organization: `host/{org}/{image}:{tag}`.

## Architecture

| Component | Role |
|-----------|------|
| `pertisk-registry` | Standalone axum service (`/v2/*`, `/service/token`) |
| Embedded mode | API merges registry routes when `REGISTRY_EMBEDDED=1` (default) |
| Gateway | Routes `/v2/*` and `/service/token` → `REGISTRY_UPSTREAM` |
| Storage | Local FS (`REGISTRY_ROOT`) or S3/MinIO (`REGISTRY_STORAGE=s3`) |
| GC | Background loop (`REGISTRY_GC_INTERVAL_SECS`) + manual API trigger |
| Web UI | `/groups/{org}/registry` — tags, metadata, git repo link |

## Quick start (embedded, single port)

```bash
make infra
export DATABASE_URL=postgres://pertisk:pertisk@localhost:5432/pertisk_gits
export JWT_SECRET=dev-secret
export REGISTRY_ROOT=data/registry
export API_PORT=8080
export GIT_PUBLIC_BASE_URL=http://localhost:8080

cargo run -p pertisk-api
# Registry at http://localhost:8080/v2/
# UI at http://localhost:8080/groups/my-org/registry
```

## MinIO storage

```bash
docker compose -f deploy/docker-compose.yml up -d minio
export REGISTRY_STORAGE=s3
export S3_ENDPOINT=http://127.0.0.1:9000
export S3_BUCKET=pertisk-registry
export S3_ACCESS_KEY=pertisk
export S3_SECRET_KEY=pertisksecret
```

Create the bucket once in the MinIO console (`http://localhost:9001`).

## Docker client

```bash
docker login localhost:8080 -u YOUR_USERNAME
docker tag myapp:latest localhost:8080/my-org/myapp:v1
docker push localhost:8080/my-org/myapp:v1
```

Tag a CI-built image with commit provenance:

```bash
docker push -H "X-Pertisk-Commit-Sha: $CI_COMMIT_SHA" ...
# or set header in manifest push from custom tooling
```

## REST API (web UI)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/organizations/{org}/registry/images` | List images |
| GET | `/api/v1/organizations/{org}/registry/images/{name}` | Image + tags |
| PATCH | `/api/v1/organizations/{org}/registry/images/{name}` | Description, link git repo |
| DELETE | `/api/v1/organizations/{org}/registry/images/{name}` | Delete image |
| DELETE | `/api/v1/organizations/{org}/registry/images/{name}/tags/{tag}` | Delete tag |
| POST | `/api/v1/organizations/{org}/registry/gc` | Run garbage collection |

## OCI endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v2/` | API version check |
| GET | `/service/token` | Issue Bearer token (Basic auth) |
| GET | `/v2/_catalog` | List repositories (`org/image`) for authenticated members |
| GET | `/v2/{org}/_catalog` | List image names within one organization |
| GET/HEAD | `/v2/{org}/{image}/manifests/{tag\|digest}` | Pull manifest |
| PUT | `/v2/{org}/{image}/manifests/{tag}` | Push manifest + tag |
| GET/HEAD | `/v2/{org}/{image}/blobs/{digest}` | Pull blob |
| POST/PATCH/PUT | `/v2/{org}/{image}/blobs/uploads/…` | Blob upload |

## Schema

- `migrations/20250630100000_phase5_registry.sql` — core tables
- `migrations/20250630120000_registry_extras.sql` — `repository_id`, `commit_sha`

## Blob upload body limit

Axum defaults to **2 MiB** per request (`DefaultBodyLimit`). Docker layer uploads (PATCH/PUT on `/v2/.../blobs/uploads/...`) exceed that.

`pertisk-api` applies `MAX_REGISTRY_BODY_BYTES` (**5 GiB**) on the **top-level app** when registry routes are embedded — a limit on the child registry router alone does not apply after `Router::merge`.

Symptom: `docker push` fails with `413` / `Failed to buffer the request body: length limit exceeded` once a chunk exceeds 2 MiB.

After deploy, verify on the server:

```bash
dd if=/dev/zero bs=1m count=3 2>/dev/null | curl -s -o /dev/null -w "%{http_code}\n" \
  -X PUT --data-binary @- \
  "http://127.0.0.1:8080/v2/test/image/blobs/uploads/00000000-0000-0000-0000-000000000001?digest=sha256:0000000000000000000000000000000000000000000000000000000000000000"
# expect 401 (unauthorized), not 413
```

## Verify (bypass proxy)

On the server, a large POST should **not** return 413 from pertisk-gits itself:

```bash
# expect 401 (auth required), NOT 413
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST --data-binary @/tmp/15mb.bin \
  "http://127.0.0.1:8080/v2/test/image/blobs/uploads/?digest=sha256:abc"
```

If localhost returns 401 but HTTPS returns 413, the limit is in **ingress/proxy**, not pertisk-gits.

---

## Anonymous pulls

When `REGISTRY_ALLOW_ANONYMOUS_PULL` is enabled (default `true`; set `0` or `false` to disable), `docker pull` works **without login** for container images **linked to a public git repository** (`repositories.visibility = public`).

```bash
# No docker login required when image is linked to a public project
docker pull localhost:8080/my-org/myapp:latest
```

Private or unlinked images still require authentication.

---

## Not yet implemented

- Automated GC in standalone worker (runs in embedded API / registry process today)

See `docs/PHASES.md` Phase 5 for the full roadmap.
