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

---

## Docker image

Multi-stage image: `docker/Dockerfile.runner.release` target `runtime` (Debian bookworm-slim + git, curl, Docker CLI).

### Build

```bash
make runner-image
# or multi-arch:
make runner-image-multi
```

### Run

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
| `replicaCount` | Number of runner pods (register one token per replica) |
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

Each replica must be registered separately (unique token) **or** share one token if you use a single registration — today one token maps to one runner row; register N runners for N replicas.

**Docker on nodes:** the default manifest mounts `hostPath` `/var/run/docker.sock`. Remove that volume for `linux`-only jobs. Use `nodeSelector` / `tolerations` for dedicated build nodes (see comments in `deployment.yaml`).

**Autoscaling:** HPA on queue depth is planned (Phase 7). Scale manually or use cluster-autoscaler on node pressure for now.

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
