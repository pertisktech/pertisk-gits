#!/usr/bin/env bash
# Build pertisk-gits and pertisk-runner packages (DEB + RPM).
# BUILD_ARCH=auto (default) builds arm64 only when DEPLOY_ARM_*_HOSTS is set.
# BUILD_ARCH=amd64 | arm64 | all overrides that.
set -euo pipefail
# shellcheck source=scripts/_lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_lib.sh"
cd_root

export VERSION="${VERSION:-0.1.89}"

array_len() {
  local name="$1"
  if [ -z "${!name+x}" ]; then
    echo 0
    return
  fi
  eval "echo \${#$name[@]}"
}

want_amd64=0
want_arm64=0
case "${BUILD_ARCH:-auto}" in
  amd64) want_amd64=1 ;;
  arm64) want_arm64=1 ;;
  all|both) want_amd64=1; want_arm64=1 ;;
  auto)
    want_amd64=1
    if [ "$(array_len DEPLOY_ARM_GITS_HOSTS)" -gt 0 ] || [ "$(array_len DEPLOY_ARM_RUNNER_HOSTS)" -gt 0 ]; then
      want_arm64=1
    fi
    ;;
  *)
    echo "BUILD_ARCH must be auto, amd64, arm64, or all (got: ${BUILD_ARCH})" >&2
    exit 1
    ;;
esac

arches=""
[ "$want_amd64" -eq 1 ] && arches="amd64"
[ "$want_arm64" -eq 1 ] && arches="${arches:+$arches }arm64"

mkdir -p release

echo "==> Building pertisk-gits packages (${arches}) v${VERSION}"
make package-clean
if [ "$want_amd64" -eq 1 ]; then
  make package-amd64 VERSION="$VERSION"
fi
if [ "$want_arm64" -eq 1 ]; then
  make package-arm64 VERSION="$VERSION"
fi

echo "==> Building pertisk-runner packages (${arches}) v${VERSION}"
make package-runner-clean
if [ "$want_amd64" -eq 1 ]; then
  make package-runner-amd64 VERSION="$VERSION"
fi
if [ "$want_arm64" -eq 1 ]; then
  make package-runner-arm64 VERSION="$VERSION"
fi

# Optional images (set BUILD_IMAGES=1):
# if [ "${BUILD_IMAGES:-0}" = "1" ]; then
#   make runner-image-multi VERSION="$VERSION"
#   make pertisk-gits-image-multi VERSION="$VERSION"
# fi

if [ "${DOCKER_PRUNE:-0}" = "1" ]; then
  docker system prune -f
fi

echo "==> Build complete. Artifacts in release/ and container registry."
