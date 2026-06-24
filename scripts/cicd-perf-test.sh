#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> CI/CD library unit tests"
cargo test -p pertisk-cicd

echo "==> Pipeline parse/schedule Criterion benches"
cargo bench -p pertisk-cicd --bench pipeline -- --noplot

echo "==> Runner noop overhead bench (100 iterations)"
cargo run -q -p pertisk-runner -- bench --iterations 100

echo "==> Workspace compile check (api + worker + runner)"
cargo check -p pertisk-api -p pertisk-worker -p pertisk-runner

echo "Done. For full integration: start API, worker, runner — see docs/CICD.md"
