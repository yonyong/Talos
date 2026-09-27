#!/bin/bash
# ============================================================
#  Talos Agent - uninstall (Linux / CentOS)
#
#    scripts-linux/uninstall.sh
#
#    1. remove the crontab keepalive
#    2. stop any running agent started from here
#
#  conf/agent.yml, logs/ and downloaded packages are KEPT - delete
#  the install directory yourself for a full wipe.
#
#  Keep LF line endings.
# ============================================================
set -u

APP_HOME="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_HOME" || exit 1

echo "[Talos] removing the crontab keepalive ..."
if command -v crontab >/dev/null 2>&1; then
  if crontab -l 2>/dev/null | grep -q -F "scripts-linux/run-agent.sh"; then
    TMP="$(mktemp)"
    crontab -l 2>/dev/null | grep -v -F "# talos-agent keepalive" | grep -v -F "scripts-linux/run-agent.sh" > "$TMP" || true
    if crontab "$TMP" 2>/dev/null; then
      echo "[Talos]     keepalive removed"
    else
      echo "[Talos]     WARNING: could not rewrite the crontab"
    fi
    rm -f "$TMP"
  else
    echo "[Talos]     no keepalive entry found"
  fi
else
  echo "[Talos]     crontab unavailable on this host"
fi

bash "$APP_HOME/scripts-linux/stop.sh"

echo "[Talos] Done. conf/, logs/ and upgrade/ were left in place."
echo "[Talos] Delete $APP_HOME manually for a full wipe."
exit 0
