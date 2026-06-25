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
