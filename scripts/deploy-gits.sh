#!/usr/bin/env bash
# Build, push, and helm-upgrade pertisk-gits.
# Set GITS_IMAGE / GITS_HELM_VALUES / HELM_NAMESPACE in scripts/hosts.local.sh.
set -euo pipefail
# shellcheck source=scripts/_lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_lib.sh"
cd_root

export VERSION="${VERSION:-0.1.89}"
GITS_REGISTRY="${GITS_REGISTRY:-ghcr.io/example/pertisk}"
GITS_IMAGE="${GITS_IMAGE:-${GITS_REGISTRY}/pertisk-gits}"
GITS_HELM_VALUES="${GITS_HELM_VALUES:-deploy/helm/pertisk-gits/values.cluster.example.yaml}"
HELM_NAMESPACE="${HELM_NAMESPACE:-pertisk-gits}"
HELM_RELEASE="${HELM_RELEASE:-pertisk-gits}"

require_var GITS_IMAGE

# --load into local docker, then push
make pertisk-gits-image VERSION="$VERSION" GITS_REGISTRY="$GITS_REGISTRY"
docker push "${GITS_IMAGE}:${VERSION}"

helm upgrade --install "$HELM_RELEASE" ./deploy/helm/pertisk-gits \
  -f "$GITS_HELM_VALUES" \
  --namespace "$HELM_NAMESPACE" \
  --create-namespace \
  --set image.repository="${GITS_IMAGE%:*}" \
  --set image.tag="$VERSION" \
  --set image.pullPolicy=Always
