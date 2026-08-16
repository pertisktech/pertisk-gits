#!/usr/bin/env bash
# Deploy pre-built pertisk-gits and pertisk-runner packages from release/.
# Run ./scripts/build.sh first (or set PACKAGE_BUILD=1 to build during deploy).
# Configure hosts in scripts/hosts.local.sh (see hosts.local.example.sh).
set -euo pipefail
# shellcheck source=scripts/_lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_lib.sh"
cd_root

export VERSION="${VERSION:-0.1.89}"
export PACKAGE_BUILD="${PACKAGE_BUILD:-0}"
export PACKAGE_CLEAN="${PACKAGE_CLEAN:-0}"

DEPLOY_GITS_HOSTS=(${DEPLOY_GITS_HOSTS[@]+"${DEPLOY_GITS_HOSTS[@]}"})
DEPLOY_RUNNER_HOSTS=(${DEPLOY_RUNNER_HOSTS[@]+"${DEPLOY_RUNNER_HOSTS[@]}"})
require_hosts DEPLOY_GITS_HOSTS
require_hosts DEPLOY_RUNNER_HOSTS

deploy() {
  make "$@" VERSION="$VERSION" PACKAGE_BUILD="$PACKAGE_BUILD" PACKAGE_CLEAN="$PACKAGE_CLEAN"
}

echo "==> Deploying v${VERSION} (PACKAGE_BUILD=${PACKAGE_BUILD})"

for host in "${DEPLOY_GITS_HOSTS[@]}"; do
  echo "==> pertisk-gits -> $host"
  deploy deploy-rpm DEPLOY_HOST="$host"
done

for host in "${DEPLOY_RUNNER_HOSTS[@]}"; do
  echo "==> pertisk-runner -> $host"
  deploy install-runner DEPLOY_HOST="$host"
done

echo "==> Deploy complete."

case "${DOCKER_PRUNE:-0}" in
  all) docker system prune -a -f ;;
  1) docker system prune -f ;;
esac
