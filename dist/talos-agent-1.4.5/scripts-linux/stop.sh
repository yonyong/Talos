#!/bin/bash
# ============================================================
#  Talos Agent - stop (Linux / CentOS)
#
#    scripts-linux/stop.sh [--with-cron]
#
#  Stops the agent running from this install directory.
#
#  NOTE: the crontab keepalive would bring it back within 5 minutes.
#  That is intentional - the agent is meant to stay up. To keep it
#  down, run scripts-linux/uninstall.sh (which also removes the
#  crontab entry), or disable the entry manually:
#      crontab -e      # comment out the "talos-agent keepalive" line
#
#  Keep LF line endings.
# ============================================================
set -u

APP_HOME="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_HOME" || exit 1

PIDFILE="run/agent.pid"
CRON=0
[ "${1:-}" = "--with-cron" ] && CRON=1

echo "[Talos] stopping the agent ..."

STOPPED=0

# ---------- 1) recorded pid ----------
if [ -f "$PIDFILE" ]; then
  PID="$(cat "$PIDFILE" 2>/dev/null | tr -dc '0-9')"
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    echo "[Talos]   terminating pid $PID"
    kill "$PID" 2>/dev/null || true
    n=0
    while [ "$n" -lt 30 ] && kill -0 "$PID" 2>/dev/null; do
      n=$((n + 1)); sleep 1
    done
    kill -0 "$PID" 2>/dev/null && kill -9 "$PID" 2>/dev/null || true
    STOPPED=1
  fi
  rm -f "$PIDFILE"
fi

# ---------- 2) any agent started from here (cron may have restarted it) ----------
for PID in $(pgrep -f 'talos-agent\.jar' 2>/dev/null || true); do
  echo "[Talos]   terminating pid $PID"
  kill "$PID" 2>/dev/null || true
  STOPPED=1
done
sleep 2
for PID in $(pgrep -f 'talos-agent\.jar' 2>/dev/null || true); do
  echo "[Talos]   pid $PID ignored SIGTERM, sending KILL"
  kill -9 "$PID" 2>/dev/null || true
done

# ---------- 3) drop the instance lock ----------
rm -f logs/.talos-agent.lock 2>/dev/null || true

if [ "$STOPPED" -eq 0 ]; then
  echo "[Talos] agent is not running."
fi

# ---------- 4) optionally remove the keepalive ----------
if [ "$CRON" -eq 1 ]; then
  echo "[Talos] removing the crontab keepalive ..."
  TMP="$(mktemp)"
  crontab -l 2>/dev/null | grep -v -F "# talos-agent keepalive" | grep -v -F "scripts-linux/run-agent.sh" > "$TMP" || true
  crontab "$TMP" 2>/dev/null && echo "[Talos]   keepalive removed" || echo "[Talos]   WARNING: could not rewrite crontab"
  rm -f "$TMP"
fi

echo "[Talos] done."
exit 0
