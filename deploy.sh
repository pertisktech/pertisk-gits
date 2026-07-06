#!/usr/bin/env bash
# Deploy pre-built pertisk-gits and pertisk-runner packages from release/.
# Run ./build.sh first (or set PACKAGE_BUILD=1 to build during deploy).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

export VERSION="${VERSION:-0.1.89}"
export PACKAGE_BUILD="${PACKAGE_BUILD:-0}"
export PACKAGE_CLEAN="${PACKAGE_CLEAN:-0}"

deploy() {
  make "$@" VERSION="$VERSION" PACKAGE_BUILD="$PACKAGE_BUILD" PACKAGE_CLEAN="$PACKAGE_CLEAN"
}

echo "==> Deploying v${VERSION} (PACKAGE_BUILD=${PACKAGE_BUILD})"

# --- pertisk-gits (RPM) ---
deploy deploy-rpm DEPLOY_HOST=nat@103.117.150.228
deploy deploy-rpm DEPLOY_HOST=root@135.181.197.40
#deploy deploy-rpm DEPLOY_HOST=almalinux@10.1.1.13
deploy deploy-rpm DEPLOY_HOST=root@187.77.155.197
#deploy deploy-rpm-arm64 DEPLOY_HOST=almalinux@10.1.1.233
deploy deploy-rpm-arm64 DEPLOY_HOST=almalinux@10.1.1.20
# --- pertisk-runner (RPM) ---
deploy install-runner DEPLOY_HOST=nat@103.117.150.228
# deploy install-runner DEPLOY_HOST=almalinux@10.1.1.14
#deploy install-runner DEPLOY_HOST=almalinux@10.1.1.13
#deploy install-runner DEPLOY_HOST=almalinux@10.1.1.233
deploy install-runner DEPLOY_HOST=root@135.181.197.40
deploy install-runner DEPLOY_HOST=root@187.77.155.197
#deploy deploy-runner-rpm-arm64 DEPLOY_HOST=almalinux@10.1.1.233

echo "==> Deploy complete."
