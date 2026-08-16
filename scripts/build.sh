#!/usr/bin/env bash
# Build pertisk-gits and pertisk-runner packages (DEB + RPM) and Docker images (amd64 + arm64).
set -euo pipefail
# shellcheck source=scripts/_lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_lib.sh"
cd_root

export VERSION="${VERSION:-0.1.89}"

mkdir -p release

echo "==> Building pertisk-gits packages (DEB + RPM, amd64 + arm64) v${VERSION}"
make package-clean
make package VERSION="$VERSION"

echo "==> Building pertisk-runner packages (DEB + RPM, amd64 + arm64) v${VERSION}"
make package-runner-clean
make package-runner VERSION="$VERSION"

# Optional images (set BUILD_IMAGES=1):
# if [ "${BUILD_IMAGES:-0}" = "1" ]; then
#   make runner-image-multi VERSION="$VERSION"
#   make pertisk-gits-image-multi VERSION="$VERSION"
# fi

if [ "${DOCKER_PRUNE:-0}" = "1" ]; then
  docker system prune -f
fi

echo "==> Build complete. Artifacts in release/ and container registry."
