#!/usr/bin/env bash
# Shared helpers for scripts/*.sh — source from other scripts, do not run directly.
# shellcheck shell=bash

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPTS_DIR/.." && pwd)"

# Load private overrides when present (gitignored).
# shellcheck source=/dev/null
if [ -f "$SCRIPTS_DIR/hosts.local.sh" ]; then
  source "$SCRIPTS_DIR/hosts.local.sh"
fi

require_var() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "error: $name is required. Set it in the environment or scripts/hosts.local.sh" >&2
    echo "  cp scripts/hosts.local.example.sh scripts/hosts.local.sh" >&2
    exit 1
  fi
}

require_hosts() {
  local name="$1"
  local len
  # Avoid nameref (Bash 4.3+) so macOS /bin/bash 3.2 works.
  eval "len=\${#$name[@]}"
  if [ "$len" -eq 0 ]; then
    echo "error: $name is empty. Set host lists in scripts/hosts.local.sh" >&2
    echo "  cp scripts/hosts.local.example.sh scripts/hosts.local.sh" >&2
    exit 1
  fi
}

cd_root() {
  cd "$ROOT_DIR"
}
