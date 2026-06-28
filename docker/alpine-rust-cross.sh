#!/bin/sh
# Install musl.cc cross toolchain on Alpine when TARGETARCH != BUILDARCH.
# Usage: alpine-rust-cross.sh <targetarch> <buildarch>
set -eu

TARGETARCH="${1:?targetarch}"
BUILDARCH="${2:?buildarch}"

if [ "$TARGETARCH" = "$BUILDARCH" ]; then
  exit 0
fi

case "$TARGETARCH" in
  amd64) TGZ=x86_64-linux-musl-cross; RUST_TARGET=x86_64-unknown-linux-musl ;;
  arm64) TGZ=aarch64-linux-musl-cross; RUST_TARGET=aarch64-unknown-linux-musl ;;
  *)
    echo "alpine-rust-cross: unsupported TARGETARCH: $TARGETARCH" >&2
    exit 1
    ;;
esac

apk add --no-cache curl tar
curl -fsSL "https://musl.cc/${TGZ}.tgz" | tar xz -C /opt
rustup target add "$RUST_TARGET"
