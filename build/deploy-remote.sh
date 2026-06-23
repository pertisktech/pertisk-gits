#!/usr/bin/env bash
# Copy DEB/RPM to a remote host and install via SSH.
#
# Usage:
#   DEPLOY_HOST=user@host ./build/deploy-remote.sh
#   DEPLOY_HOST=user@host DEPLOY_PKG=rpm ./build/deploy-remote.sh
#
# Env:
#   DEPLOY_HOST     — required, e.g. root@192.168.1.10
#   DEPLOY_BIN      — pertisk-gits (default)
#   DEPLOY_ARCH     — amd64 (default) or arm64
#   DEPLOY_PKG      — auto (default), deb, or rpm
#   VERSION         — package version (default: git describe)
#   DEPLOY_SSH_OPTS — extra ssh options, e.g. "-i ~/.ssh/key"
#   DEPLOY_RESTART  — 1 (default) restart systemd service after install
#   PACKAGE_BUILD   — 1 (default) build package if missing in release/
#   PACKAGE_CLEAN   — 1 (default) run make package-clean before build

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DEPLOY_HOST="${DEPLOY_HOST:?set DEPLOY_HOST=user@host}"
DEPLOY_BIN="${DEPLOY_BIN:-pertisk-gits}"
DEPLOY_ARCH="${DEPLOY_ARCH:-amd64}"
DEPLOY_PKG="${DEPLOY_PKG:-auto}"
DEPLOY_RESTART="${DEPLOY_RESTART:-1}"
DEPLOY_SSH_OPTS="${DEPLOY_SSH_OPTS:-}"
PACKAGE_BUILD="${PACKAGE_BUILD:-1}"
PACKAGE_CLEAN="${PACKAGE_CLEAN:-1}"
VERSION="${VERSION:-$(git describe --tags --always 2>/dev/null | sed 's/^v//' || echo '0.1.0')}"
VERSION="${VERSION#v}"
RELEASE_DIR="${RELEASE_DIR:-release}"

case "$DEPLOY_ARCH" in
  amd64) deb_arch=amd64; rpm_arch=x86_64 ;;
  arm64) deb_arch=arm64; rpm_arch=aarch64 ;;
  *) echo "DEPLOY_ARCH must be amd64 or arm64" >&2; exit 1 ;;
esac

ssh_cmd() {
  # shellcheck disable=SC2086
  ssh $DEPLOY_SSH_OPTS "$DEPLOY_HOST" "$@"
}

scp_cmd() {
  # shellcheck disable=SC2086
  scp $DEPLOY_SSH_OPTS "$@"
}

detect_pkg_type() {
  if [ "$DEPLOY_PKG" != "auto" ]; then
    echo "$DEPLOY_PKG"
    return
  fi
  if ssh_cmd 'command -v dpkg >/dev/null 2>&1'; then
    echo deb
  elif ssh_cmd 'command -v rpm >/dev/null 2>&1'; then
    echo rpm
  else
    echo "Cannot detect package manager on $DEPLOY_HOST (set DEPLOY_PKG=deb or rpm)" >&2
    exit 1
  fi
}

PKG_TYPE="$(detect_pkg_type)"

find_package() {
  local pattern=""
  case "$PKG_TYPE" in
    deb)
      pattern="${RELEASE_DIR}/${DEPLOY_BIN}_${VERSION}_${deb_arch}.deb"
      ;;
    rpm)
      pattern="${RELEASE_DIR}/${DEPLOY_BIN}-${VERSION}-1.${rpm_arch}.rpm"
      if [ ! -f "$pattern" ]; then
        pattern="$(ls -1 "${RELEASE_DIR}/${DEPLOY_BIN}"-"${VERSION}"*.rpm 2>/dev/null | head -n1 || true)"
      fi
      ;;
    *)
      echo "Unsupported DEPLOY_PKG=$PKG_TYPE" >&2
      exit 1
      ;;
  esac
  if [ -n "$pattern" ] && [ -f "$pattern" ]; then
    echo "$pattern"
    return 0
  fi
  return 1
}

build_package() {
  echo "Building ${PKG_TYPE} package (linux/${DEPLOY_ARCH}, version ${VERSION})..."
  if [ "$PACKAGE_CLEAN" = "1" ]; then
    make package-clean
  fi
  make "package-${DEPLOY_ARCH}" VERSION="${VERSION}"
}

PKG_FILE=""
if ! PKG_FILE="$(find_package)"; then
  if [ "$PACKAGE_BUILD" = "1" ]; then
    build_package
    PKG_FILE="$(find_package)" || {
      echo "Package still not found for $DEPLOY_BIN $VERSION ($DEPLOY_ARCH/$PKG_TYPE) after build." >&2
      echo "Check release/ and build logs." >&2
      exit 1
    }
  else
    echo "Package not found for $DEPLOY_BIN $VERSION ($DEPLOY_ARCH/$PKG_TYPE)." >&2
    echo "Run: make package-${DEPLOY_ARCH} VERSION=$VERSION" >&2
    exit 1
  fi
fi
REMOTE_NAME="$(basename "$PKG_FILE")"

echo "Deploying $PKG_FILE -> $DEPLOY_HOST:/tmp/$REMOTE_NAME"
scp_cmd "$PKG_FILE" "$DEPLOY_HOST:/tmp/$REMOTE_NAME"

case "$PKG_TYPE" in
  deb)
    ssh_cmd "sudo dpkg -i /tmp/$REMOTE_NAME || sudo apt-get install -f -y"
    ;;
  rpm)
    ssh_cmd "if command -v dnf >/dev/null 2>&1; then sudo dnf install -y /tmp/$REMOTE_NAME; elif command -v yum >/dev/null 2>&1; then sudo yum localinstall -y /tmp/$REMOTE_NAME; else sudo rpm -Uvh /tmp/$REMOTE_NAME; fi"
    ;;
esac

if [ "$DEPLOY_RESTART" = "1" ]; then
  ssh_cmd "sudo systemctl enable $DEPLOY_BIN --now 2>/dev/null || sudo systemctl restart $DEPLOY_BIN"
  ssh_cmd "sudo systemctl status $DEPLOY_BIN --no-pager || true"
fi

echo "Deployed $DEPLOY_BIN $VERSION to $DEPLOY_HOST"
