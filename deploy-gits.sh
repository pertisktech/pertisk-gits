#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

export VERSION="${VERSION:-0.4.22}"
KUBECONFIG="${KUBECONFIG:-/Users/nat/.kube/omni-proxmox-285h-kubeconfig.yaml}"
GITS_IMAGE="${GITS_IMAGE:-harbor.homelab.pertisk.com/pertisksoft/pertisk-proxy/pertisk-gits}"

# --load into local docker, then push (buildx --push hits TLS failure to Harbor over bridge net)
make pertisk-gits-image VERSION="$VERSION"
docker push "${GITS_IMAGE}:${VERSION}"

helm upgrade --install pertisk-gits ./deploy/helm/pertisk-gits \
  -f deploy/helm/pertisk-gits/values-talos.yaml \
  --namespace pertisk-proxy \
  --create-namespace \
  --set image.tag="$VERSION" \
  --set image.pullPolicy=Always \
  --kubeconfig "$KUBECONFIG"
