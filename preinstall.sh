#!/bin/sh
set -e
if ! getent group pertisk-gits >/dev/null 2>&1; then
  groupadd --system pertisk-gits
fi
if ! getent passwd pertisk-gits >/dev/null 2>&1; then
  useradd --system --gid pertisk-gits --home-dir /var/lib/pertisk-gits \
    --shell /usr/sbin/nologin --comment "Pertisk Gits" pertisk-gits
fi
