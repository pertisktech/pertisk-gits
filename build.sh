#!/usr/bin/env bash
# Build pertisk-gits and pertisk-runner packages (DEB + RPM) and Docker images (amd64 + arm64).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

export VERSION="${VERSION:-0.1.89}"

mkdir -p release

echo "==> Building pertisk-gits packages (DEB + RPM, amd64 + arm64) v${VERSION}"
make package-clean
make package VERSION="$VERSION"

echo "==> Building pertisk-runner packages (DEB + RPM, amd64 + arm64) v${VERSION}"
make package-runner-clean
make package-runner VERSION="$VERSION"

echo "==> Building pertisk-runner Docker image (amd64 + arm64) v${VERSION}"
make runner-image-multi VERSION="$VERSION"

echo "==> Building pertisk-gits Docker image (amd64 + arm64) v${VERSION}"
make pertisk-gits-image-multi VERSION="$VERSION"

echo "==> Build complete. Artifacts in release/ and container registry."
