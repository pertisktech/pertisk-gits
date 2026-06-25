#!/usr/bin/env bash
# Shared Docker helpers for package scripts (Linux CI runners, macOS dev).
set -euo pipefail

# Bind-mount repo root into packaging containers. :Z relabels for SELinux (RHEL/Alma).
docker_work_volume() {
  local src="${1:?}"
  if command -v getenforce >/dev/null 2>&1 && [ "$(getenforce 2>/dev/null)" = "Enforcing" ]; then
    printf '%s:/work:Z' "$src"
  else
    printf '%s:/work' "$src"
  fi
}

# Build DEB/RPM via fpm inside docker/Dockerfile.package.
# Uses docker cp (not bind mounts) so CI workspaces under /tmp/pertisk-ci-* work when
# the Docker daemon cannot see the runner temp directory via -v.
run_fpm_in_docker() {
  local image="${1:?image name}"
  local fpm_script="${2:?container script path}"
  local workdir pkg

  workdir="$(cd "$(pwd)" && pwd)"
  pkg="pkg-${PACKAGE_NAME}"

  if [ ! -d "$pkg" ]; then
    echo "Error: ${pkg} not found in ${workdir}" >&2
    return 1
  fi
  for hook in preinstall.sh postinstall.sh preremove.sh; do
    if [ ! -f "$hook" ]; then
      echo "Error: ${hook} not found in ${workdir}" >&2
      return 1
    fi
  done

  mkdir -p "${RELEASE_DIR}"

  echo "Building DEB and RPM in Linux container (workdir=${workdir})..."
  docker build -f docker/Dockerfile.package -t "$image" .

  local cid
  cid="$(docker create -w /work \
    -e PACKAGE_NAME="$PACKAGE_NAME" \
    -e VERSION="$VERSION" \
    -e deb_arch="$deb_arch" \
    -e rpm_arch="$rpm_arch" \
    "$image" "$fpm_script")"

  docker cp "${workdir}/${pkg}" "${cid}:/work/${pkg}"
  docker cp "${workdir}/preinstall.sh" "${cid}:/work/preinstall.sh"
  docker cp "${workdir}/postinstall.sh" "${cid}:/work/postinstall.sh"
  docker cp "${workdir}/preremove.sh" "${cid}:/work/preremove.sh"

  trap 'docker rm -f "$cid" >/dev/null 2>&1 || true' RETURN
  docker start -a "$cid"
  docker cp "${cid}:/work/release/." "${workdir}/${RELEASE_DIR}/"
  docker rm -f "$cid" >/dev/null
  trap - RETURN
}
