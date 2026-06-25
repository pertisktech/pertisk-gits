#!/usr/bin/env bash
# Build DEB, RPM, and tarball for pertisk-gits (API + embedded web UI).
# Usage: ./build/package.sh <amd64|arm64> [VERSION] [all]
# Requires: docker. DEB/RPM use fpm (Linux) or docker/Dockerfile.package (macOS).
# Run from repo root.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=docker-common.sh
source "${SCRIPT_DIR}/docker-common.sh"

ARCH="${1:?Usage: $0 <amd64|arm64> [VERSION] [all]}"
VERSION="${2:-$(git describe --tags --always 2>/dev/null | sed 's/^v//' || echo '0.1.0')}"
VERSION="${VERSION#v}"
TARGET="${3:-all}"
PACKAGE_NAME=pertisk-gits
CARGO_BIN=pertisk-api
RELEASE_DIR="release"
CACHE_DIR="${CACHE_DIR:-.buildx-cache/release}"
BUILDER_NAME="${BUILDER_NAME:-pertisk-gits-package}"
mkdir -p "$RELEASE_DIR"

case "$ARCH" in
  amd64) deb_arch=amd64; rpm_arch=x86_64 ;;
  arm64) deb_arch=arm64; rpm_arch=aarch64 ;;
  *)
    echo "Error: ARCH must be amd64 or arm64" >&2
    exit 1
    ;;
esac

make web-dist VERSION="$VERSION"
if [ ! -f web/dist/index.html ]; then
  echo "Error: web/dist not found after web-dist build." >&2
  exit 1
fi

HOST_ARCH="$(uname -m)"
case "$HOST_ARCH" in
  x86_64) HOST_ARCH=amd64 ;;
  aarch64|arm64) HOST_ARCH=arm64 ;;
esac
HOST_OS="$(uname -s)"

artifact="${PACKAGE_NAME}-linux-${ARCH}"

expected_file_pattern() {
  case "$1" in
    amd64) echo 'ELF 64-bit.*x86-64' ;;
    arm64) echo 'ELF 64-bit.*ARM aarch64' ;;
    *) return 1 ;;
  esac
}

is_valid_linux_binary() {
  local binary_path="$1"
  local arch="$2"
  local expected

  [ -f "$binary_path" ] || return 1
  command -v file >/dev/null 2>&1 || return 0

  expected="$(expected_file_pattern "$arch")" || return 1
  file "$binary_path" | grep -Eq "$expected"
}

build_native() {
  echo "Using native cargo build for $PACKAGE_NAME (linux/$ARCH, version $VERSION)..."
  CARGO_BUILD_JOBS="${CARGO_JOBS:-4}" PERTISK_VERSION="$VERSION" cargo build --release --locked -p "$CARGO_BIN" -p pertisk-worker
  cp "target/release/$CARGO_BIN" "./${artifact}"
  cp "target/release/pertisk-worker" "./pertisk-worker-linux-${ARCH}"
  chmod +x "./${artifact}" "./pertisk-worker-linux-${ARCH}"
}

build_binary_docker() {
  echo "Building $PACKAGE_NAME for linux/$ARCH via Docker buildx..."
  export DOCKER_BUILDKIT=1
  CARGO_JOBS="${PERTISK_CARGO_JOBS:-1}"
  [ "$ARCH" = "amd64" ] && CARGO_JOBS=4

  if docker buildx inspect "$BUILDER_NAME" --bootstrap >/dev/null 2>&1; then
    :
  else
    echo "Buildx builder '$BUILDER_NAME' is missing; creating..."
    docker buildx rm "$BUILDER_NAME" >/dev/null 2>&1 || true
    docker buildx create --name "$BUILDER_NAME" --driver docker-container --bootstrap
  fi

  mkdir -p "$CACHE_DIR"
  local build_success=0
  cache_from=()
  if [ -f "${CACHE_DIR}/index.json" ]; then
    cache_from=(--cache-from "type=local,src=${CACHE_DIR}")
  fi
  for attempt in 1 2 3; do
    if docker buildx build --builder "$BUILDER_NAME" --platform "linux/$ARCH" \
      -f docker/Dockerfile.release \
      "${cache_from[@]}" \
      --cache-to "type=local,dest=${CACHE_DIR},mode=max" \
      --build-arg VERSION="$VERSION" \
      --build-arg CARGO_BUILD_JOBS="$CARGO_JOBS" \
      --progress=plain \
      --load -t "pertisk-gits-build:$ARCH" .; then
      build_success=1
      break
    fi
    if [ "$attempt" -lt 3 ]; then
      echo "docker buildx build failed (attempt $attempt/3); recreating builder..."
      docker buildx rm "$BUILDER_NAME" >/dev/null 2>&1 || true
      docker buildx create --name "$BUILDER_NAME" --driver docker-container --bootstrap
    fi
  done
  if [ "$build_success" -ne 1 ]; then
    echo "Error: docker buildx build failed after 3 attempts" >&2
    exit 1
  fi

  docker rm -f "extract-gits-$ARCH" 2>/dev/null || true
  docker create --name "extract-gits-$ARCH" "pertisk-gits-build:$ARCH"
  docker cp "extract-gits-$ARCH:/app/out/pertisk-gits" "./${artifact}"
  docker cp "extract-gits-$ARCH:/app/out/pertisk-worker" "./pertisk-worker-linux-${ARCH}"
  chmod +x "./${artifact}" "./pertisk-worker-linux-${ARCH}"
  docker rm "extract-gits-$ARCH"
}

version_stamp="${artifact}.version"
need_rebuild=0
if [ -f "$artifact" ] && ! is_valid_linux_binary "$artifact" "$ARCH"; then
  echo "Removing stale $artifact (not Linux/$ARCH)..."
  rm -f "$artifact" "$version_stamp"
fi
if [ ! -f "$artifact" ]; then
  need_rebuild=1
elif [ ! -f "$version_stamp" ] || [ "$(cat "$version_stamp")" != "$VERSION" ]; then
  echo "Rebuilding $artifact (version ${VERSION}, was $(cat "$version_stamp" 2>/dev/null || echo missing))..."
  rm -f "$artifact" "$version_stamp"
  need_rebuild=1
fi

if [ "$need_rebuild" -eq 1 ]; then
  force_docker="${PERTISK_FORCE_DOCKER_BUILD:-}"
  echo "Binary build: ARCH=$ARCH HOST=$HOST_OS/$HOST_ARCH PERTISK_FORCE_DOCKER_BUILD=${force_docker:-0}"
  if [ "$force_docker" = "1" ] || [ "$force_docker" = "true" ]; then
    build_binary_docker
  elif [ "$ARCH" = "$HOST_ARCH" ] && [ "$HOST_OS" = "Linux" ] && command -v cargo >/dev/null 2>&1; then
    build_native
  else
    if [ "$ARCH" = "$HOST_ARCH" ] && [ "$HOST_OS" = "Linux" ]; then
      echo "cargo not in PATH; using Docker buildx..."
    fi
    build_binary_docker
  fi
  echo "$VERSION" > "$version_stamp"
fi

if ! is_valid_linux_binary "$artifact" "$ARCH"; then
  echo "Error: $artifact is not a valid Linux/$ARCH executable" >&2
  command -v file >/dev/null 2>&1 && file "$artifact" >&2 || true
  exit 1
fi
cp "$artifact" "$RELEASE_DIR/"

cat > build/pertisk-gits.service << 'SVC'
[Unit]
Description=Pertisk Gits (Git hosting platform)
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=pertisk-gits
Group=pertisk-gits
WorkingDirectory=/var/lib/pertisk-gits
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
EnvironmentFile=-/etc/pertisk-gits/pertisk-gits.conf
ExecStart=/usr/bin/pertisk-gits
Restart=always
RestartSec=5
TimeoutStopSec=30
LimitNOFILE=65535
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/pertisk-gits
PrivateTmp=true
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
SVC

cat > build/pertisk-worker.service << 'SVC'
[Unit]
Description=Pertisk Gits CI scheduler worker
After=network.target postgresql.service pertisk-gits.service
Wants=postgresql.service

[Service]
Type=simple
User=pertisk-gits
Group=pertisk-gits
WorkingDirectory=/var/lib/pertisk-gits
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
EnvironmentFile=-/etc/pertisk-gits/pertisk-gits.conf
ExecStart=/usr/bin/pertisk-worker
Restart=always
RestartSec=5
TimeoutStopSec=30
LimitNOFILE=65535
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/pertisk-gits
PrivateTmp=true
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
SVC

cat > build/pertisk-gits.conf << 'CONF'
# Pertisk Gits — single-port (UI + API + Git HTTP)
API_HOST=0.0.0.0
API_PORT=8080
DATABASE_URL=postgres://pertisk:change-me@127.0.0.1:5432/pertisk_gits
JWT_SECRET=change-me-in-production-use-a-long-random-string
REPOS_ROOT=/var/lib/pertisk-gits/repos
GIT_PUBLIC_BASE_URL=http://localhost:8080
WEB_DIST=/usr/share/pertisk-gits/web
RUST_LOG=info,pertisk_api=info
CONF

rm -rf "pkg-${PACKAGE_NAME}"
mkdir -p "pkg-${PACKAGE_NAME}/usr/bin" \
  "pkg-${PACKAGE_NAME}/etc/pertisk-gits" \
  "pkg-${PACKAGE_NAME}/var/lib/pertisk-gits/repos" \
  "pkg-${PACKAGE_NAME}/usr/share/pertisk-gits/web" \
  "pkg-${PACKAGE_NAME}/lib/systemd/system"

cp "$artifact" "pkg-${PACKAGE_NAME}/usr/bin/${PACKAGE_NAME}"
cp "pertisk-worker-linux-${ARCH}" "pkg-${PACKAGE_NAME}/usr/bin/pertisk-worker"
chmod +x "pkg-${PACKAGE_NAME}/usr/bin/${PACKAGE_NAME}" "pkg-${PACKAGE_NAME}/usr/bin/pertisk-worker"
cp build/pertisk-gits.conf "pkg-${PACKAGE_NAME}/etc/pertisk-gits/pertisk-gits.conf"
cp build/pertisk-gits.service "pkg-${PACKAGE_NAME}/lib/systemd/system/pertisk-gits.service"
cp build/pertisk-worker.service "pkg-${PACKAGE_NAME}/lib/systemd/system/pertisk-worker.service"
cp -r web/dist/. "pkg-${PACKAGE_NAME}/usr/share/pertisk-gits/web/"

cat > preinstall.sh << 'PRE'
#!/bin/sh
set -e
if ! getent group pertisk-gits >/dev/null 2>&1; then
  groupadd --system pertisk-gits
fi
if ! getent passwd pertisk-gits >/dev/null 2>&1; then
  useradd --system --gid pertisk-gits --home-dir /var/lib/pertisk-gits \
    --shell /usr/sbin/nologin --comment "Pertisk Gits" pertisk-gits
fi
PRE

cat > postinstall.sh << 'POST'
#!/bin/sh
set -e
mkdir -p /var/lib/pertisk-gits/repos
chown -R pertisk-gits:pertisk-gits /var/lib/pertisk-gits
chmod 750 /var/lib/pertisk-gits
if [ -d /etc/pertisk-gits ]; then
  chown -R root:pertisk-gits /etc/pertisk-gits
  chmod 750 /etc/pertisk-gits
  chmod 640 /etc/pertisk-gits/pertisk-gits.conf 2>/dev/null || true
fi
command -v systemctl >/dev/null 2>&1 && systemctl daemon-reload || true
command -v systemctl >/dev/null 2>&1 && systemctl enable pertisk-gits --now 2>/dev/null || true
command -v systemctl >/dev/null 2>&1 && systemctl enable pertisk-worker --now 2>/dev/null || true
POST

cat > preremove.sh << 'PRE'
#!/bin/sh
set -e
if command -v systemctl >/dev/null 2>&1; then
  systemctl stop pertisk-worker 2>/dev/null || true
  systemctl disable pertisk-worker 2>/dev/null || true
  systemctl stop pertisk-gits 2>/dev/null || true
  systemctl disable pertisk-gits 2>/dev/null || true
fi
PRE

chmod +x preinstall.sh postinstall.sh preremove.sh

if command -v xattr >/dev/null 2>&1; then
  xattr -cr "pkg-${PACKAGE_NAME}" 2>/dev/null || true
fi

[ "$(uname -s)" = "Darwin" ] && export COPYFILE_DISABLE=1

FPM_CMD=""
if command -v fpm >/dev/null 2>&1; then
  FPM_CMD="fpm"
else
  for dir in "$HOME/.gem/ruby/"*/bin "$HOME/.local/share/gem/ruby/"*/bin; do
    [ -x "${dir}/fpm" ] 2>/dev/null || continue
    FPM_CMD="${dir}/fpm"
    break
  done
fi

force_docker="${PERTISK_FORCE_DOCKER_BUILD:-}"
use_docker_packaging=0
if [ "$(uname -s)" = "Darwin" ]; then
  use_docker_packaging=1
elif [ -z "$FPM_CMD" ]; then
  use_docker_packaging=1
fi
echo "Package build: use_docker_packaging=${use_docker_packaging} fpm=${FPM_CMD:-missing} PERTISK_FORCE_DOCKER_BUILD=${force_docker:-0}"

if [ "$use_docker_packaging" -eq 1 ] && command -v docker >/dev/null 2>&1; then
  run_fpm_in_docker pertisk-gits-package /usr/local/bin/deb-rpm.sh
elif [ -n "$FPM_CMD" ]; then
  $FPM_CMD -s dir -t deb --force \
    -n "$PACKAGE_NAME" -v "$VERSION" -a "$deb_arch" \
    --description "Pertisk Gits — self-hosted Git platform" \
    --url "https://github.com/pertisktech/pertisk-gits" \
    --maintainer "Pertisk Team" --license "MIT" --vendor "Pertisk" \
    --category "net" --depends git \
    --before-install preinstall.sh --after-install postinstall.sh --before-remove preremove.sh \
    --config-files "/etc/pertisk-gits/pertisk-gits.conf" \
    --directories /var/lib/pertisk-gits \
    --deb-systemd-enable --deb-no-default-config-files \
    -p "$RELEASE_DIR" -C "pkg-${PACKAGE_NAME}" .

  if command -v rpmbuild >/dev/null 2>&1; then
    $FPM_CMD -s dir -t rpm --force \
      -n "$PACKAGE_NAME" -v "$VERSION" -a "$rpm_arch" \
      --description "Pertisk Gits — self-hosted Git platform" \
      --url "https://github.com/pertisktech/pertisk-gits" \
      --maintainer "Pertisk Team" --license "MIT" --vendor "Pertisk" \
      --category "System Environment/Daemons" \
      --depends git --depends shadow-utils \
      --before-install preinstall.sh --after-install postinstall.sh --before-remove preremove.sh \
      --config-files "/etc/pertisk-gits/pertisk-gits.conf" \
      --directories /var/lib/pertisk-gits \
      --rpm-os linux \
      -p "$RELEASE_DIR" -C "pkg-${PACKAGE_NAME}" .
  fi
else
  echo "fpm not found and docker unavailable: skipping DEB/RPM"
fi

tar -czvf "$RELEASE_DIR/${PACKAGE_NAME}-v${VERSION}-linux-${ARCH}.tar.gz" \
  -C "pkg-${PACKAGE_NAME}" usr etc var lib 2>/dev/null || \
tar -czvf "$RELEASE_DIR/${PACKAGE_NAME}-v${VERSION}-linux-${ARCH}.tar.gz" \
  -C "pkg-${PACKAGE_NAME}" usr lib

rm -f preinstall.sh postinstall.sh preremove.sh

echo "Done. Artifacts in $RELEASE_DIR/:"
ls -1 "$RELEASE_DIR"/*"${ARCH}"* 2>/dev/null || ls -1 "$RELEASE_DIR/"
