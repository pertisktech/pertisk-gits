#!/usr/bin/env bash
# Shared Docker helpers for package scripts (Linux CI runners, macOS dev).
set -euo pipefail

# Parallel rustc invocations inside Docker builder (cross-compiles run on host CPU).
docker_cargo_jobs() {
  echo "${PERTISK_CARGO_JOBS:-${CARGO_BUILD_JOBS:-4}}"
}

# Host platform for buildx (BUILDPLATFORM). Ensures arm64 targets cross-compile on amd64 Macs.
docker_host_linux_arch() {
  case "$(uname -m)" in
    x86_64) echo amd64 ;;
    aarch64|arm64) echo arm64 ;;
    *) echo amd64 ;;
  esac
}

docker_build_platform_args() {
  local target_arch="$1"
  local host_arch
  host_arch="$(docker_host_linux_arch)"
  printf '%s\n' \
    "--build-arg" "BUILDARCH=${host_arch}" \
    "--build-arg" "BUILDPLATFORM=linux/${host_arch}" \
    "--build-arg" "TARGETARCH=${target_arch}" \
    "--build-arg" "TARGETPLATFORM=linux/${target_arch}"
}

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

# Cross-compile Linux binaries with buildx and export via type=local (reliable for arm64 on amd64 hosts).
# Usage: buildx_export_linux_binaries <builder> <dockerfile> <export_target> <arch> <version> <cache_dir> <out_dir> [extra build-arg flags...]
buildx_export_linux_binaries() {
  local builder_name="$1"
  local dockerfile="$2"
  local export_target="$3"
  local arch="$4"
  local version="$5"
  local cache_dir="$6"
  local out_dir="$7"
  shift 7

  export DOCKER_BUILDKIT=1

  if ! docker buildx inspect "$builder_name" --bootstrap >/dev/null 2>&1; then
    echo "Buildx builder '$builder_name' is missing; creating..."
    docker buildx rm "$builder_name" >/dev/null 2>&1 || true
    docker buildx create --name "$builder_name" --driver docker-container --bootstrap
  fi

  mkdir -p "$cache_dir"
  rm -rf "$out_dir"
  mkdir -p "$out_dir"

  local cache_from=()
  if [ -f "${cache_dir}/index.json" ]; then
    cache_from=(--cache-from "type=local,src=${cache_dir}")
  fi

  local cargo_jobs
  cargo_jobs="$(docker_cargo_jobs)"
  local host_arch
  host_arch="$(docker_host_linux_arch)"
  echo "Docker buildx: host=linux/${host_arch} target=linux/${arch} cargo_jobs=${cargo_jobs}"

  local build_success=0
  local attempt
  for attempt in 1 2 3; do
    if [ "${#cache_from[@]}" -gt 0 ]; then
      # shellcheck disable=SC2046
      if docker buildx build --builder "$builder_name" --platform "linux/${arch}" \
        -f "$dockerfile" \
        --target "$export_target" \
        "${cache_from[@]}" \
        --cache-to "type=local,dest=${cache_dir},mode=max" \
        $(docker_build_platform_args "$arch") \
        --build-arg "VERSION=${version}" \
        --build-arg "CARGO_BUILD_JOBS=${cargo_jobs}" \
        "$@" \
        --progress=plain \
        --output "type=local,dest=${out_dir}" \
        .; then
        build_success=1
        break
      fi
    else
      # shellcheck disable=SC2046
      if docker buildx build --builder "$builder_name" --platform "linux/${arch}" \
        -f "$dockerfile" \
        --target "$export_target" \
        --cache-to "type=local,dest=${cache_dir},mode=max" \
        $(docker_build_platform_args "$arch") \
        --build-arg "VERSION=${version}" \
        --build-arg "CARGO_BUILD_JOBS=${cargo_jobs}" \
        "$@" \
        --progress=plain \
        --output "type=local,dest=${out_dir}" \
        .; then
        build_success=1
        break
      fi
    fi
    if [ "$attempt" -lt 3 ]; then
      echo "docker buildx build failed (attempt ${attempt}/3); recreating builder..."
      docker buildx rm "$builder_name" >/dev/null 2>&1 || true
      docker buildx create --name "$builder_name" --driver docker-container --bootstrap
    fi
  done

  if [ "$build_success" -ne 1 ]; then
    echo "Error: docker buildx build failed after 3 attempts" >&2
    return 1
  fi
}
