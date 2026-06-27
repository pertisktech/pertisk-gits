#!/usr/bin/env bash
set -euo pipefail

export VERSION="${VERSION:-0.1.89}"
make runner-image-multi VERSION="$VERSION"
helm upgrade --install pertisk-runner ./deploy/helm/pertisk-runner \
  -f deploy/helm/pertisk-runner/values-kubernetes.yaml \
  --namespace pertisk-proxy \
  --create-namespace \
  --set apiUrl=https://gitdev.apps.thaidevops.co \
  --set runnerToken=ptr_cffb67334d6d4f018f4426019eec6d73 \
  --set image.tag="$VERSION" \
  --set image.pullPolicy=Always \
  --set-json 'nodeSelector={"kubernetes.io/arch":"arm64"}'