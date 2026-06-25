#!/usr/bin/env bash
# Build DEB, RPM, and tarball for pertisk-runner (self-hosted CI).
# Usage: ./build/package-runner.sh <amd64|arm64> [VERSION] [all]
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
PACKAGE_NAME=pertisk-runner
CARGO_BIN=pertisk-runner
RELEASE_DIR="release"
CACHE_DIR="${CACHE_DIR:-.buildx-cache/runner-release}"
BUILDER_NAME="${BUILDER_NAME:-pertisk-runner-package}"
mkdir -p "$RELEASE_DIR"

case "$ARCH" in
  amd64) deb_arch=amd64; rpm_arch=x86_64 ;;
  arm64) deb_arch=arm64; rpm_arch=aarch64 ;;
  *)
    echo "Error: ARCH must be amd64 or arm64" >&2
    exit 1
    ;;
esac

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
  CARGO_BUILD_JOBS="${CARGO_JOBS:-4}" PERTISK_VERSION="$VERSION" cargo build --release --locked -p "$CARGO_BIN"
  cp "target/release/$CARGO_BIN" "./${artifact}"
  chmod +x "./${artifact}"
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
      -f docker/Dockerfile.runner.release \
      "${cache_from[@]}" \
      --cache-to "type=local,dest=${CACHE_DIR},mode=max" \
      --build-arg VERSION="$VERSION" \
      --build-arg CARGO_BUILD_JOBS="$CARGO_JOBS" \
      --progress=plain \
      --load -t "pertisk-runner-build:$ARCH" .; then
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

  docker rm -f "extract-runner-$ARCH" 2>/dev/null || true
  docker create --name "extract-runner-$ARCH" "pertisk-runner-build:$ARCH"
  docker cp "extract-runner-$ARCH:/app/out/${PACKAGE_NAME}" "./${artifact}"
  chmod +x "./${artifact}"
  docker rm "extract-runner-$ARCH"
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

cat > build/pertisk-runner.service << 'SVC'
[Unit]
Description=Pertisk Gits CI runner
After=network.target pertisk-gits.service
Wants=network.target

[Service]
Type=simple
User=pertisk-runner
Group=pertisk-runner
WorkingDirectory=/var/lib/pertisk-runner
Environment=HOME=/var/lib/pertisk-runner
Environment=GIT_CONFIG_COUNT=1
Environment=GIT_CONFIG_KEY_0=safe.directory
Environment=GIT_CONFIG_VALUE_0=*
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
EnvironmentFile=-/etc/pertisk-runner/pertisk-runner.conf
ExecStart=/usr/bin/pertisk-runner run
Restart=always
RestartSec=5
TimeoutStopSec=30
LimitNOFILE=65535
PrivateTmp=true
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
SVC

cat > build/pertisk-runner.conf << 'CONF'
# Pertisk Gits CI runner — set token from: POST /api/v1/runners/register
PERTISK_API_URL=http://127.0.0.1:8080
PERTISK_RUNNER_TOKEN=change-me-register-via-api
PERTISK_REPOS_ROOT=/var/lib/pertisk-gits/repos
RUST_LOG=info,pertisk_runner=info
CONF

rm -rf "pkg-${PACKAGE_NAME}"
mkdir -p "pkg-${PACKAGE_NAME}/usr/bin" \
  "pkg-${PACKAGE_NAME}/etc/pertisk-runner" \
  "pkg-${PACKAGE_NAME}/var/lib/pertisk-runner" \
  "pkg-${PACKAGE_NAME}/lib/systemd/system"

cp "$artifact" "pkg-${PACKAGE_NAME}/usr/bin/${PACKAGE_NAME}"
chmod +x "pkg-${PACKAGE_NAME}/usr/bin/${PACKAGE_NAME}"
cp build/pertisk-runner.conf "pkg-${PACKAGE_NAME}/etc/pertisk-runner/pertisk-runner.conf"
cp build/pertisk-runner.service "pkg-${PACKAGE_NAME}/lib/systemd/system/pertisk-runner.service"

cat > preinstall.sh << 'PRE'
#!/bin/sh
set -e
if ! getent group pertisk-runner >/dev/null 2>&1; then
  groupadd --system pertisk-runner
fi
if ! getent passwd pertisk-runner >/dev/null 2>&1; then
  useradd --system --gid pertisk-runner --home-dir /var/lib/pertisk-runner \
    --shell /usr/sbin/nologin --comment "Pertisk Gits CI runner" pertisk-runner
fi
if getent group pertisk-gits >/dev/null 2>&1; then
  usermod -a -G pertisk-gits pertisk-runner 2>/dev/null || true
fi
if getent group docker >/dev/null 2>&1; then
  usermod -a -G docker pertisk-runner 2>/dev/null || true
fi
PRE

cat > postinstall.sh << 'POST'
#!/bin/sh
set -e
mkdir -p /var/lib/pertisk-runner
chown -R pertisk-runner:pertisk-runner /var/lib/pertisk-runner
chmod 750 /var/lib/pertisk-runner
gitconfig=/var/lib/pertisk-runner/.gitconfig
if [ ! -f "$gitconfig" ] || ! grep -q 'directory = \*' "$gitconfig" 2>/dev/null; then
  printf '%s\n' '[safe]' '	directory = *' > "$gitconfig"
  chown pertisk-runner:pertisk-runner "$gitconfig"
  chmod 600 "$gitconfig"
fi
if [ -d /etc/pertisk-runner ]; then
  chown -R root:pertisk-runner /etc/pertisk-runner
  chmod 750 /etc/pertisk-runner
  chmod 640 /etc/pertisk-runner/pertisk-runner.conf 2>/dev/null || true
fi
if getent group docker >/dev/null 2>&1 && command -v systemctl >/dev/null 2>&1; then
  systemctl try-restart pertisk-runner 2>/dev/null || true
fi
command -v systemctl >/dev/null 2>&1 && systemctl daemon-reload || true
POST

cat > preremove.sh << 'PRE'
#!/bin/sh
set -e
if command -v systemctl >/dev/null 2>&1; then
  systemctl stop pertisk-runner 2>/dev/null || true
  systemctl disable pertisk-runner 2>/dev/null || true
fi
PRE

chmod +x preinstall.sh postinstall.sh preremove.sh

if command -v xattr >/dev/null 2>&1; then
  xattr -cr "pkg-${PACKAGE_NAME}" 2>/dev/null || true
fi

[ "$(uname -s)" = "Darwin" ] && export COPYFILE_DISABLE=1

build_deb_rpm_docker() {
  local workdir
  workdir="$(pwd)"
  echo "Building DEB and RPM in Linux container (workdir=${workdir})..."
  if [ ! -d "pkg-${PACKAGE_NAME}" ]; then
    echo "Error: pkg-${PACKAGE_NAME} not found in ${workdir}" >&2
    exit 1
  fi
  docker build -f docker/Dockerfile.package -t pertisk-runner-package .
  docker run --rm \
    -v "$(docker_work_volume "$workdir")" \
    -w /work \
    -e PACKAGE_NAME="$PACKAGE_NAME" \
    -e VERSION="$VERSION" \
    -e deb_arch="$deb_arch" \
    -e rpm_arch="$rpm_arch" \
    pertisk-runner-package /usr/local/bin/deb-rpm-runner.sh
}

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
  build_deb_rpm_docker
elif [ -n "$FPM_CMD" ]; then
  $FPM_CMD -s dir -t deb --force \
    -n "$PACKAGE_NAME" -v "$VERSION" -a "$deb_arch" \
    --description "Pertisk Gits self-hosted CI runner" \
    --url "https://github.com/pertisktech/pertisk-gits" \
    --maintainer "Pertisk Team" --license "MIT" --vendor "Pertisk" \
    --category "net" --depends git \
    --before-install preinstall.sh --after-install postinstall.sh --before-remove preremove.sh \
    --config-files "/etc/pertisk-runner/pertisk-runner.conf" \
    --deb-systemd-enable --deb-no-default-config-files \
    -p "$RELEASE_DIR" -C "pkg-${PACKAGE_NAME}" .

  if command -v rpmbuild >/dev/null 2>&1; then
    $FPM_CMD -s dir -t rpm --force \
      -n "$PACKAGE_NAME" -v "$VERSION" -a "$rpm_arch" \
      --description "Pertisk Gits self-hosted CI runner" \
      --url "https://github.com/pertisktech/pertisk-gits" \
      --maintainer "Pertisk Team" --license "MIT" --vendor "Pertisk" \
      --category "System Environment/Daemons" \
      --depends git --depends shadow-utils \
      --before-install preinstall.sh --after-install postinstall.sh --before-remove preremove.sh \
      --config-files "/etc/pertisk-runner/pertisk-runner.conf" \
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
ls -1 "$RELEASE_DIR"/*"${PACKAGE_NAME}"*"${ARCH}"* 2>/dev/null || ls -1 "$RELEASE_DIR"/${PACKAGE_NAME}* 2>/dev/null || true
