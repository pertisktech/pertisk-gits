#!/usr/bin/env bash
# Deploy packages to cloud hosts. Configure DEPLOY_CLOUD_*_HOSTS in scripts/hosts.local.sh.
set -euo pipefail
# shellcheck source=scripts/_lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_lib.sh"
cd_root

export VERSION="${VERSION:-0.1.89}"

DEPLOY_CLOUD_GITS_HOSTS=(${DEPLOY_CLOUD_GITS_HOSTS[@]+"${DEPLOY_CLOUD_GITS_HOSTS[@]}"})
DEPLOY_CLOUD_RUNNER_HOSTS=(${DEPLOY_CLOUD_RUNNER_HOSTS[@]+"${DEPLOY_CLOUD_RUNNER_HOSTS[@]}"})
require_hosts DEPLOY_CLOUD_GITS_HOSTS
require_hosts DEPLOY_CLOUD_RUNNER_HOSTS

for host in "${DEPLOY_CLOUD_GITS_HOSTS[@]}"; do
  echo "==> pertisk-gits -> $host"
  make deploy-rpm DEPLOY_HOST="$host" VERSION="$VERSION"
done

for host in "${DEPLOY_CLOUD_RUNNER_HOSTS[@]}"; do
  echo "==> pertisk-runner -> $host"
  make install-runner DEPLOY_HOST="$host" VERSION="$VERSION"
done

if [ "${PUSH_RUNNER_IMAGE_MULTI:-0}" = "1" ]; then
  make runner-image-multi VERSION="$VERSION"
fi
