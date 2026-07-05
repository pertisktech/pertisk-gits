# CI Runner deployment

`pertisk-runner` polls the Pertisk API for pipeline jobs, runs shell steps, streams logs, and uploads artifacts. Register each runner with **labels** that match `runs-on` in `.pertisk-ci.yaml` (e.g. `linux`, `docker`).

See also [CICD.md](./CICD.md) for pipeline configuration and API endpoints.

## 1. Register a runner

In the web UI: **Runners → Register runner** — set a name and at least one label.

Or via API:

```bash
curl -X POST "$PERTISK_API_URL/api/v1/runners/register" \
  -H "Authorization: Bearer $USER_JWT" \
  -H "Content-Type: application/json" \
  -d '{"name":"build-01","labels":["linux","docker"]}'
# → { "runner_id": "...", "token": "ptr_..." }
```

Save the `ptr_…` token — it is shown once.

## 2. Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `PERTISK_RUNNER_TOKEN` | Yes | Token from registration |
| `PERTISK_API_URL` | Yes | API base URL (e.g. `https://git.example.com`) |
| `PERTISK_REPOS_ROOT` | No | Path to bare repos on the git host (faster checkout) |
| `PERTISK_RUNNER_MAX_PARALLEL` | No | Max concurrent jobs per runner process (default `1`) |
| `RUST_LOG` | No | Default `info,pertisk_runner=info` |

Runners do **not** need inbound ports — they poll the API outbound.

---

## Linux service (systemd) — production

RPM/DEB packages install `pertisk-runner` as a systemd service.

```bash
# Build and deploy RPM to a remote host
make install-runner DEPLOY_HOST=user@host VERSION=0.1.0

# On the host
sudo vi /etc/pertisk-runner/pertisk-runner.conf
sudo systemctl enable --now pertisk-runner
sudo systemctl status pertisk-runner
```

Example `/etc/pertisk-runner/pertisk-runner.conf`:

```ini
PERTISK_API_URL=https://git.example.com
PERTISK_RUNNER_TOKEN=ptr_...
PERTISK_REPOS_ROOT=/var/lib/pertisk-gits/repos
RUST_LOG=info,pertisk_runner=info
```

### Docker build jobs on the host

Steps run as the `pertisk-runner` user. For `runs-on: docker` pipelines:

```bash
sudo usermod -aG docker pertisk-runner
sudo systemctl restart pertisk-runner
sudo -u pertisk-runner docker ps
```

The RPM postinstall adds `pertisk-runner` to the `docker` group when Docker is installed.

### Parallel job execution

Independent queued jobs (no `needs` between them) or expanded `parallel: N` instances run concurrently when enough runners are available.

- **Scale horizontally:** register multiple runners with the same labels (Helm `replicaCount`, multiple systemd hosts, etc.).
- **Scale per process:** set `PERTISK_RUNNER_MAX_PARALLEL=4` so one runner process claims and runs up to four jobs at once.

```ini
PERTISK_RUNNER_MAX_PARALLEL=4
```

`runs-on: [linux, docker]` requires the runner to have **both** labels (subset match).

---

## Docker image

Multi-stage image: `docker/Dockerfile.runner.release` target `runtime` (Debian bookworm-slim + git, curl, Docker CLI).

Default registry: `harbor.tools.thaidevops.co/pertisksoft/pertisk-proxy/runner`

```bash
docker login harbor.tools.thaidevops.co

# Local load (amd64)
make runner-image VERSION=0.1.84

# Push amd64 to Harbor
make runner-image-push VERSION=0.1.84

# Push amd64 + arm64 (separate builds merged into one manifest — required for ARM nodes)
make runner-image-multi VERSION=0.1.84

# ARM only (Talos / Graviton nodes)
make runner-image-arm64 VERSION=0.1.84
```

Tags `0.2.29` and `0.2.30` shipped an amd64 binary in the arm64 manifest (buildx combined-platform bug). Use **`0.2.31+`** from `runner-image-multi`.

Override registry: `make runner-image-push RUNNER_REGISTRY=my.registry.example/pertisk`

### Run locally

```bash
docker run -d --name pertisk-runner --restart unless-stopped \
  -e PERTISK_API_URL=https://git.example.com \
  -e PERTISK_RUNNER_TOKEN=ptr_... \
  -v pertisk-runner-work:/var/lib/pertisk-runner \
  -v /var/run/docker.sock:/var/run/docker.sock \
  pertisk-runner:latest
```

Mount `/var/run/docker.sock` only when jobs use `runs-on: docker`. If you see permission errors, run as root: `--user 0:0`.

---

## Docker Compose

For dev or small installs:

```bash
cp deploy/.env.runner.example deploy/.env.runner
# Edit deploy/.env.runner — set PERTISK_API_URL and PERTISK_RUNNER_TOKEN

make runner-image
make runner-compose-up
```

```bash
make runner-compose-down   # stop
docker compose -f deploy/docker-compose.runner.yml logs -f runner
```

Set `RUNNER_USER=0:0` in `.env.runner` if the Docker socket is not accessible to the container user.

---

## Kubernetes

#### Executor modes

| Mode | `PERTISK_RUNNER_EXECUTOR` | Behavior |
|------|---------------------------|----------|
| **Shell** (default) | `shell` | Steps run on the runner pod/host |
| **Kubernetes** | `kubernetes` | Manager spawns a **Job pod per pipeline job** (GitLab-style) |

#### Shell pool (multi-replica)

All pods in a Helm release **share one runner token**. The API uses `FOR UPDATE SKIP LOCKED` so each pod claims a different queued job. With `replicaCount: 3`, up to **three jobs** can run at once.

```bash
helm upgrade pertisk-runner ./deploy/helm/pertisk-runner \
  --reuse-values --set replicaCount=3
```

#### Kubernetes executor (per-job pods)

Like [GitLab Kubernetes executor](https://docs.gitlab.com/runner/executors/kubernetes/): one **manager** Deployment polls the API; each job becomes a `batch/v1` Job with:

1. **helper** init container — downloads workspace from the API  
2. **build** container — runs generated bash script for all steps  

```bash
# Register runner with label: kubernetes
helm upgrade --install pertisk-runner ./deploy/helm/pertisk-runner \
  -f deploy/helm/pertisk-runner/values-kubernetes.yaml \
  --namespace pertisk --create-namespace \
  --set apiUrl=https://git.example.com \
  --set runnerToken=ptr_... \
  --set image.tag=0.2.29 \
  --set image.pullPolicy=Always
```

`values-kubernetes.yaml` includes `nodeSelector.kubernetes.io/arch: arm64` for ARM clusters. To override from CLI, use JSON (not dotted `--set`, which breaks keys like `kubernetes.io/arch`):

```bash
--set-json 'nodeSelector={"kubernetes.io/arch":"arm64"}'
```

Pipeline jobs must use `runs-on: kubernetes`:

```yaml
jobs:
  build:
    runs-on: kubernetes
    image: rust:1-bookworm   # optional — per-job image (GitLab-style)
    steps:
      - name: test
        run: make test
```

When `image` is omitted, the runner uses `kubernetes.buildImage` / `PERTISK_K8S_BUILD_IMAGE` (default `debian:bookworm-slim`). Official images (`golang`, `rust`, `node`, etc.) work as-is — steps run with `bash -c` so the image `PATH` is preserved (login shells would strip `/usr/local/go/bin`, `/usr/local/cargo/bin`, etc.).

**Docker / buildx in job pods** — set `dind: true` on the job and use a Docker CLI image (e.g. `docker:27-cli`). The runner adds a privileged `docker:dind` sidecar; both containers share a `docker.sock` via `emptyDir` (no unencrypted TCP API). The cluster must allow privileged pods.

```yaml
jobs:
  image:
    runs-on: kubernetes
    dind: true
    image: docker:27-cli
    steps:
      - run: docker buildx build --push -t registry.example.com/app:latest .
```

| | **Shell pool** | **Kubernetes executor** |
|--|----------------|-------------------------|
| Scale | `replicaCount` on manager | One Job pod per active job |
| Isolation | Shared runner pod | Per-job pod (`emptyDir` workspace) |
| Docker builds | `docker.sock` on host (optional) | `dind: true` + `image: docker:*-cli` for buildx |

Environment (manager pod):

| Variable | Description |
|----------|-------------|
| `PERTISK_RUNNER_EXECUTOR` | `kubernetes` |
| `PERTISK_K8S_NAMESPACE` | Where job pods are created |
| `PERTISK_K8S_RELEASE` | Helm release name — labels CI jobs for uninstall cleanup |
| `PERTISK_K8S_BUILD_IMAGE` | Image for build container (default `debian:bookworm-slim`) |
| `PERTISK_K8S_DIND_IMAGE` | DinD sidecar image when job sets `dind: true` (default `docker:27.5.1-dind`) |
| `PERTISK_K8S_HELPER_IMAGE` | Init container image (default `curlimages/curl`) |

`helm uninstall` runs a pre-delete hook that removes `pertisk-job-*` Jobs and script ConfigMaps labeled for that release (`kubernetes.cleanupOnUninstall`, default `true`). Finished job pods are also removed after `kubernetes.ttlSecondsAfterFinished` (default 600s).

Admin **Runners** only lists manager pods seen in the last ~3 minutes and job pods tied to a still-`running` CI job — stale entries disappear after redeploy without waiting 24h.

Optional CPU-based HPA (shell mode only):

```yaml
autoscaling:
  enabled: true
  minReplicas: 1
  maxReplicas: 10
  targetCPUUtilizationPercentage: 75
```

### Helm (recommended)

Chart: `deploy/helm/pertisk-runner`

```bash
# Register runner in UI → copy ptr_… token
helm upgrade --install pertisk-runner ./deploy/helm/pertisk-runner \
  --namespace pertisk --create-namespace \
  --set apiUrl=https://git.example.com \
  --set runnerToken=ptr_... \
  --set image.tag=0.1.82
```

Production — use an existing Secret instead of `--set runnerToken`:

```bash
kubectl create secret generic pertisk-runner-secret \
  --namespace pertisk \
  --from-literal=token=ptr_...

helm upgrade --install pertisk-runner ./deploy/helm/pertisk-runner \
  --namespace pertisk \
  --set apiUrl=https://git.example.com \
  --set existingSecret.name=pertisk-runner-secret
```

Useful values:

| Value | Description |
|-------|-------------|
| `executor` | `shell` (default) or `kubernetes` |
| `replicaCount` | Shell pool size — shared token, ~1 concurrent job per pod |
| `kubernetes.buildImage` | CI build container image (k8s executor) |
| `kubernetes.cleanupOnUninstall` | `helm uninstall` deletes `pertisk-job-*` resources (default `true`) |
| `autoscaling.enabled` | CPU-based HPA (shell mode) |
| `podAntiAffinity.enabled` | Spread pods across nodes (default `true`) |
| `dockerSock.enabled` | Mount host `/var/run/docker.sock` (default `true`) |
| `runAsRoot` | Set `true` if docker.sock permission errors |
| `nodeSelector` / `tolerations` | Pin to dedicated build nodes |

```bash
helm lint deploy/helm/pertisk-runner
helm template pertisk-runner deploy/helm/pertisk-runner --set runnerToken=test
```

### Raw manifests

Manifests in `deploy/k8s/runner/` (same layout, no templating):

```bash
cp deploy/k8s/runner/secret.yaml.example deploy/k8s/runner/secret.yaml
# Edit secret.yaml (token) and configmap.yaml (api_url)

kubectl apply -f deploy/k8s/runner/configmap.yaml \
              -f deploy/k8s/runner/secret.yaml \
              -f deploy/k8s/runner/deployment.yaml
```

Scale replicas for more capacity:

```bash
kubectl scale deployment pertisk-runner --replicas=3
```

Or use Helm: `--set replicaCount=3` (same shared token).

**Docker on nodes:** the default manifest mounts `hostPath` `/var/run/docker.sock`. Set `dockerSock.enabled: false` for `linux`-only jobs. Use `nodeSelector` / `tolerations` for dedicated build nodes.

**Autoscaling:** enable `autoscaling` in Helm values, or use cluster-autoscaler on node pressure. Queue-depth HPA is planned (Phase 7).

---

## Colocated vs distributed

| Setup | `PERTISK_REPOS_ROOT` | Checkout |
|-------|----------------------|----------|
| Same host as git server | Set to server `REPOS_ROOT` | Fast local bare clone |
| Remote runner | Unset | API serves workspace tarball |

Distributed runners only need outbound HTTPS to `PERTISK_API_URL`.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `401 Unauthorized` in logs | Wrong or rotated token — re-register and update config |
| Jobs stuck queued | Runner offline or labels don't match `runs-on` |
| `docker: permission denied` | Add user to `docker` group (systemd) or mount sock + `RUNNER_USER=0:0` (container) |
| Slow checkout | Colocate runner; set `PERTISK_REPOS_ROOT` |

```bash
# systemd logs
journalctl -u pertisk-runner -f

# container logs
docker logs -f pertisk-runner
```

Bench runner overhead (no API):

```bash
cargo run -p pertisk-runner -- bench --iterations 100
```
