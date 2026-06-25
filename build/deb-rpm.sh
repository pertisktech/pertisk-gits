#!/usr/bin/env bash
# Run inside docker/Dockerfile.package. Builds .deb and .rpm for pertisk-gits.
set -euo pipefail
cd /work
mkdir -p /work/release

BINARY_NAME="${PACKAGE_NAME:-pertisk-gits}"

if [ ! -d "/work/pkg-${BINARY_NAME}" ]; then
  echo "Error: /work/pkg-${BINARY_NAME} not found" >&2
  ls -la /work >&2 || true
  exit 1
fi

fpm -s dir -t deb --force \
  -n "$BINARY_NAME" \
  -v "$VERSION" \
  -a "$deb_arch" \
  --description "Pertisk Gits — self-hosted Git platform" \
  --url "https://github.com/pertisktech/pertisk-gits" \
  --maintainer "Pertisk Team" \
  --license "MIT" \
  --vendor "Pertisk" \
  --category "net" \
  --depends git \
  --before-install /work/preinstall.sh \
  --after-install /work/postinstall.sh \
  --before-remove /work/preremove.sh \
  --config-files "/etc/pertisk-gits/pertisk-gits.conf" \
  --directories /var/lib/pertisk-gits \
  --deb-systemd-enable \
  --deb-no-default-config-files \
  -p /work/release \
  -C "/work/pkg-${BINARY_NAME}" .

fpm -s dir -t rpm --force \
  -n "$BINARY_NAME" \
  -v "$VERSION" \
  -a "$rpm_arch" \
  --description "Pertisk Gits — self-hosted Git platform" \
  --url "https://github.com/pertisktech/pertisk-gits" \
  --maintainer "Pertisk Team" \
  --license "MIT" \
  --vendor "Pertisk" \
  --category "System Environment/Daemons" \
  --depends git \
  --depends shadow-utils \
  --before-install /work/preinstall.sh \
  --after-install /work/postinstall.sh \
  --before-remove /work/preremove.sh \
  --config-files "/etc/pertisk-gits/pertisk-gits.conf" \
  --directories /var/lib/pertisk-gits \
  --rpm-os linux \
  -p /work/release \
  -C "/work/pkg-${BINARY_NAME}" .
