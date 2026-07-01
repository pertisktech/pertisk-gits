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

for pkg in pertisk-cicd pertisk-search; do
  crate="${pkg#pertisk-}"
  echo "  checking ${pkg} (lib, crates/${crate}/src)..."
  cargo tarpaulin --ignore-config -p "$pkg" --lib \
    --include-files "crates/${crate}/src/*" \
    --fail-under "$THRESHOLD"
done
