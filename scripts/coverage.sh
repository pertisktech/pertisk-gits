#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! cargo tarpaulin --version >/dev/null 2>&1; then
  echo "cargo-tarpaulin is required. Install with: cargo install cargo-tarpaulin" >&2
  exit 1
fi

echo "Running workspace coverage (all Rust crates: lib + bin + tests)..."
cargo tarpaulin

echo ""
echo "HTML report: target/coverage/tarpaulin-report.html"
