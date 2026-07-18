# Kubernetes deployment

Helm charts for running Pertisk Gits on Kubernetes.

| Chart | Purpose |
|-------|---------|
| `deploy/helm/pertisk-gits` | Platform API + Git HTTP + web UI + embedded registry |
| `deploy/helm/pertisk-runner` | CI runners (shell pool or per-job pods) |

## Platform (`pertisk-gits`)

Prerequisites:

- PostgreSQL 16+ (external or in-cluster)
- Persistent volume for bare repositories (`REPOS_ROOT`)
- Ingress or LoadBalancer for HTTPS

```bash
helm upgrade --install pertisk-gits ./deploy/helm/pertisk-gits \
  --namespace pertisk --create-namespace \
  --set publicUrl=https://git.example.com \
  --set database.url='postgres://user:pass@postgres:5432/pertisk_gits' \
  --set jwt.secret='change-me' \
  --set ingress.enabled=true \
  --set ingress.hosts[0].host=git.example.com
```

Production: store `DATABASE_URL` and `JWT_SECRET` in an existing Kubernetes Secret and reference `database.existingSecret` / `jwt.existingSecret` in values.

### What runs in the chart

- Single `pertisk-api` Deployment (Git Smart HTTP, REST API, SPA, OCI registry when embedded)
- PVC mounted at `/data/repos` for bare git storage
- Liveness `/health/live`, readiness `/health`

### Not included (bring your own or extend)

- PostgreSQL — use CloudNativePG, RDS, or `deploy/docker-compose.yml` for dev
- Git SSH — expose `GIT_SSH_PORT` via a separate Service/LB or run SSH on a node (see [RUNNERS.md](./RUNNERS.md))
- `pertisk-worker` — import job backup and pipeline trigger flush run inside `pertisk-api` by default
- Pingora gateway — chart targets all-in-one `pertisk-api`; add an ingress controller for TLS termination

## CI runners

See [RUNNERS.md](./RUNNERS.md#kubernetes). Point `apiUrl` at the platform `publicUrl`.

```bash
helm upgrade --install pertisk-runner ./deploy/helm/pertisk-runner \
  --namespace pertisk \
  --set apiUrl=https://git.example.com \
  --set runnerToken=ptr_...
```

## Makefile helpers

```bash
make helm-gits-lint
make helm-gits-template
```

Build and push multi-arch platform image (Harbor):

```bash
docker login harbor.homelab.pertisk.com/pertisksoft/pertisk-proxy
make pertisk-gits-image-multi VERSION=0.2.65
```

Image: `harbor.homelab.pertisk.com/pertisksoft/pertisk-proxy/pertisk-gits:VERSION` (also `:latest`).

## Planned (Phase 7)

- HPA on runner queue depth
- GitOps webhooks (Argo CD / Flux)
- Optional subchart for PostgreSQL

## High availability (platform)

Default chart values are **single-replica** (`replicaCount: 1`, `ReadWriteOnce` PVC).

For **active/active API** pods, use shared git storage and an HA database:

```bash
# Example: Talos Orion + NFS (see values-ha-talos.yaml)
kubectl create secret generic pertisk-gits-secret -n pertisk-proxy \
  --from-literal=database-url='postgres://USER:PASS@HOST:5432/pertisk_gits' \
  --from-literal=jwt-secret='LONG_RANDOM_SECRET'

helm upgrade --install pertisk-gits ./deploy/helm/pertisk-gits \
  --namespace pertisk-proxy \
  -f deploy/helm/pertisk-gits/values-ha-talos.yaml
```

| Requirement | HA platform |
|-------------|-------------|
| `replicaCount` | 2+ |
| `persistence.accessMode` | `ReadWriteMany` (NFS, EFS, CephFS) |
| PostgreSQL | Managed HA cluster (external to chart) |
| Ingress / LB | `ingress.enabled` or external proxy |
| CI runners | Separate chart — already supports HPA (`pertisk-runner`) |

**Note:** Git SSH uses a separate TCP listener; HTTP ingress alone does not cover `git@host:port` clones.
