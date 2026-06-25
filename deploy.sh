#!/usr/bin/env bash
set -euo pipefail

export VERSION="${VERSION:-0.1.87}"

make deploy-rpm DEPLOY_HOST=nat@103.117.150.228 VERSION="$VERSION"
make install-runner DEPLOY_HOST=nat@103.117.150.228 VERSION="$VERSION"
make install-runner DEPLOY_HOST=almalinux@10.1.1.14 VERSION="$VERSION"
make install-runner DEPLOY_HOST=root@135.181.197.40 VERSION="$VERSION"
