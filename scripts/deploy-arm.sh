#!/usr/bin/env bash
# Deploy ARM64 packages. Configure DEPLOY_ARM_*_HOSTS in scripts/hosts.local.sh.
set -euo pipefail
# shellcheck source=scripts/_lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_lib.sh"
cd_root

export VERSION="${VERSION:-0.1.89}"
export PACKAGE_BUILD="${PACKAGE_BUILD:-0}"
export PACKAGE_CLEAN="${PACKAGE_CLEAN:-0}"

DEPLOY_ARM_GITS_HOSTS=(${DEPLOY_ARM_GITS_HOSTS[@]+"${DEPLOY_ARM_GITS_HOSTS[@]}"})
DEPLOY_ARM_RUNNER_HOSTS=(${DEPLOY_ARM_RUNNER_HOSTS[@]+"${DEPLOY_ARM_RUNNER_HOSTS[@]}"})
require_hosts DEPLOY_ARM_GITS_HOSTS
require_hosts DEPLOY_ARM_RUNNER_HOSTS

deploy() {
  make "$@" VERSION="$VERSION" PACKAGE_BUILD="$PACKAGE_BUILD" PACKAGE_CLEAN="$PACKAGE_CLEAN"
}

echo "==> Deploying ARM64 v${VERSION} (PACKAGE_BUILD=${PACKAGE_BUILD})"

for host in "${DEPLOY_ARM_GITS_HOSTS[@]}"; do
  echo "==> pertisk-gits arm64 -> $host"
  deploy deploy-rpm-arm64 DEPLOY_HOST="$host"
done

for host in "${DEPLOY_ARM_RUNNER_HOSTS[@]}"; do
  echo "==> pertisk-runner arm64 -> $host"
  deploy deploy-runner-rpm-arm64 DEPLOY_HOST="$host"
done

echo "==> Deploy complete."
