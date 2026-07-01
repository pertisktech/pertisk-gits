#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! cargo tarpaulin --version >/dev/null 2>&1; then
  echo "cargo-tarpaulin is required. Install with: cargo install cargo-tarpaulin" >&2
  exit 1
fi

THRESHOLD="${COVERAGE_THRESHOLD:-80}"

echo "Running workspace coverage (all Rust crates: lib + bin + tests)..."
cargo tarpaulin

echo ""
echo "HTML report: target/coverage/tarpaulin-report.html"
echo ""
echo "Enforcing ${THRESHOLD}% line coverage on unit-testable library crates..."

for pkg in pertisk-cicd pertisk-search pertisk-domain pertisk-worker; do
  crate="${pkg#pertisk-}"
  threshold="${THRESHOLD}"
  extra_args=()
  if [ "$pkg" = "pertisk-worker" ]; then
    threshold="${WORKER_COVERAGE_THRESHOLD:-10}"
  fi
  if [ "$pkg" = "pertisk-domain" ]; then
    # org_groups.rs is async DB-only; pure helpers are covered in org_path.rs tests.
    extra_args=(--exclude-files "crates/domain/src/org_groups.rs")
  fi
  echo "  checking ${pkg} (lib, crates/${crate}/src, threshold=${threshold}%)..."
  cargo tarpaulin --ignore-config -p "$pkg" --lib \
    --include-files "crates/${crate}/src/*" \
    "${extra_args[@]}" \
    --fail-under "$threshold"
done
