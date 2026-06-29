#!/bin/sh
set -e
mkdir -p /var/lib/pertisk-gits/repos
chown -R pertisk-gits:pertisk-gits /var/lib/pertisk-gits
chmod 750 /var/lib/pertisk-gits
if [ -d /etc/pertisk-gits ]; then
  chown -R root:pertisk-gits /etc/pertisk-gits
  chmod 750 /etc/pertisk-gits
  chmod 640 /etc/pertisk-gits/pertisk-gits.conf 2>/dev/null || true
fi
command -v systemctl >/dev/null 2>&1 && systemctl daemon-reload || true
command -v systemctl >/dev/null 2>&1 && systemctl enable pertisk-gits --now 2>/dev/null || true
command -v systemctl >/dev/null 2>&1 && systemctl enable pertisk-worker --now 2>/dev/null || true
