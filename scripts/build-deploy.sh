#!/usr/bin/env bash
# Build all artifacts, then deploy to hosts from hosts.local.sh.
set -euo pipefail
# shellcheck source=scripts/_lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_lib.sh"
cd_root

export VERSION="${VERSION:-0.1.89}"
sudo make fix-perms
"${SCRIPTS_DIR}/build.sh"
"${SCRIPTS_DIR}/deploy.sh"
