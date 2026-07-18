#!/usr/bin/env bash
set -euo pipefail

export VERSION="${VERSION:-0.4.24}"
# amd64 load+push (buildx --push hits Harbor TLS over bridge); multi-arch optional:
#   make runner-image-multi VERSION="$VERSION"
make runner-image VERSION="$VERSION"
docker push "harbor.homelab.pertisk.com/pertisksoft/pertisk-proxy/runner:${VERSION}"
helm upgrade --install pertisk-runner ./deploy/helm/pertisk-runner \
  -f deploy/helm/pertisk-runner/values-kubernetes.yaml \
  --namespace pertisk-proxy \
  --create-namespace \
  --set apiUrl=https://gitdev.talos.pertisk.com \
  --set runnerToken=ptr_061968d418b144f6aa7e78511eacac85 \
  --set image.tag="$VERSION" \
  --set image.pullPolicy=Always \
  --set-json 'nodeSelector={"kubernetes.io/arch":"amd64"}'