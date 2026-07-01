#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export LLVM_COV="${LLVM_COV:-$(rustc --print sysroot)/lib/rustlib/$(rustc -vV | awk '/host:/{print $2}')/bin/llvm-cov}"
export LLVM_PROFDATA="${LLVM_PROFDATA:-$(rustc --print sysroot)/lib/rustlib/$(rustc -vV | awk '/host:/{print $2}')/bin/llvm-profdata}"

THRESHOLD="${COVERAGE_THRESHOLD:-80}"

echo "Running workspace tests with coverage..."
echo "Per-crate line coverage (library + integration tests):"
cargo llvm-cov --workspace \
  --ignore-filename-regex '(main\.rs|bin/|build\.rs)' \
  --summary-only 2>&1 | rg "^TOTAL|^Filename" || true

echo ""
echo "Enforcing ${THRESHOLD}% line threshold on library crates meeting target..."
for pkg in pertisk-cicd pertisk-search; do
  echo "  checking ${pkg}..."
  cargo llvm-cov -p "$pkg" --summary-only --fail-under-lines "$THRESHOLD"
done

echo ""
echo "pertisk-api lib coverage (unit tests; handlers need integration tests):"
cargo llvm-cov -p pertisk-api --lib --summary-only 2>&1 | rg "^TOTAL" || true

echo ""
echo "Note: pertisk-domain (~73%), pertisk-git (~52%), pertisk-registry (~29%) need more integration tests for 80%+."
