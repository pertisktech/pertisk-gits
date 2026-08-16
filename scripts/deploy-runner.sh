#!/usr/bin/env bash
# Build, push, and helm-upgrade pertisk-runner.
# Set API_URL, RUNNER_TOKEN, and registry overrides in scripts/hosts.local.sh.
set -euo pipefail
# shellcheck source=scripts/_lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_lib.sh"
cd_root

export VERSION="${VERSION:-0.1.89}"
RUNNER_REGISTRY="${RUNNER_REGISTRY:-ghcr.io/example/pertisk}"
RUNNER_IMAGE="${RUNNER_IMAGE:-${RUNNER_REGISTRY}/runner}"
RUNNER_HELM_VALUES="${RUNNER_HELM_VALUES:-deploy/helm/pertisk-runner/values-kubernetes.yaml}"
HELM_NAMESPACE="${HELM_NAMESPACE:-pertisk-gits}"
HELM_RELEASE="${HELM_RELEASE:-pertisk-runner}"
API_URL="${API_URL:-}"
RUNNER_TOKEN="${RUNNER_TOKEN:-}"

require_var API_URL
require_var RUNNER_TOKEN

make runner-image VERSION="$VERSION" RUNNER_REGISTRY="$RUNNER_REGISTRY"
docker push "${RUNNER_IMAGE}:${VERSION}"

helm upgrade --install "$HELM_RELEASE" ./deploy/helm/pertisk-runner \
  -f "$RUNNER_HELM_VALUES" \
  --namespace "$HELM_NAMESPACE" \
  --create-namespace \
  --set apiUrl="$API_URL" \
  --set runnerToken="$RUNNER_TOKEN" \
  --set image.repository="$RUNNER_IMAGE" \
  --set image.tag="$VERSION" \
  --set image.pullPolicy=Always \
  --set-json 'nodeSelector={"kubernetes.io/arch":"amd64"}'
