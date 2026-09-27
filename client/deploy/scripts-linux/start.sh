#!/bin/bash
# ============================================================
#  Talos Agent - start (Linux / CentOS)
#
#    scripts-linux/start.sh
#
#  Starts the agent in the background. Idempotent: does nothing
#  when an agent is already running.
#
#  Keep LF line endings.
# ============================================================
set -u

APP_HOME="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_HOME" || exit 1

PIDFILE="run/agent.pid"

if [ ! -f conf/agent.yml ]; then
  echo "[Talos] conf/agent.yml not found."
  echo "[Talos] Run scripts-linux/install.sh first, then start again."
  exit 1
fi

mkdir -p logs run

# ---------- already running? ----------
RUNNING="$(pgrep -f 'talos-agent\.jar' 2>/dev/null | head -n1 || true)"
if [ -n "$RUNNING" ]; then
  echo "[Talos] agent is already running, pid $RUNNING. Nothing to do."
  echo "[Talos]   inspect : scripts-linux/status.sh"
  echo "[Talos]   stop    : scripts-linux/stop.sh"
  exit 0
fi

echo "[Talos] starting the agent in the background ..."
nohup bash "$APP_HOME/scripts-linux/run-agent.sh" >> logs/start.log 2>&1 &
PID=$!
echo "$PID" > "$PIDFILE"

sleep 5
if kill -0 "$PID" 2>/dev/null; then
  echo "[Talos] started, pid $PID"
else
  # the wrapper may have exited while the JVM it exec'd lives on
  ACTUAL="$(pgrep -f 'talos-agent\.jar' 2>/dev/null | head -n1 || true)"
  if [ -n "$ACTUAL" ]; then
    echo "$ACTUAL" > "$PIDFILE"
    echo "[Talos] started, pid $ACTUAL"
  else
    echo "[Talos] WARNING: the process is not running. Check:"
    echo "[Talos]   tail -n 30 $APP_HOME/logs/agent.log"
    exit 1
  fi
fi
exit 0
