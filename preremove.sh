#!/bin/sh
set -e
if command -v systemctl >/dev/null 2>&1; then
  systemctl stop pertisk-worker 2>/dev/null || true
  systemctl disable pertisk-worker 2>/dev/null || true
  systemctl stop pertisk-gits 2>/dev/null || true
  systemctl disable pertisk-gits 2>/dev/null || true
fi
