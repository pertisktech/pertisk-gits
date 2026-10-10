#!/usr/bin/env bash
# Build all artifacts, then deploy.
# Hosts: scripts/hosts.local.sh, or one-off DEPLOY_HOST=user@host.
set -euo pipefail
# shellcheck source=scripts/_lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_lib.sh"
cd_root

export VERSION="${VERSION:-0.1.89}"
sudo make fix-perms
"${SCRIPTS_DIR}/build.sh"
"${SCRIPTS_DIR}/deploy.sh"
