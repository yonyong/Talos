#!/bin/bash
# ============================================================
#  Talos Agent - foreground runner (Linux / CentOS)
#
#    scripts-linux/run-agent.sh
#
#  Runs the agent in the foreground. This is the crontab entry
#  point: cron starts it every 5 minutes and the JVM itself
#  enforces single-instance through logs/.talos-agent.lock, so a
#  duplicate trigger simply starts and exits again.
#
#  The 5-minute interval is what keeps the agent alive: if the JVM
#  died, the next tick brings it back.
#
#  Keep LF line endings.
# ============================================================
set -u

APP_HOME="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_HOME" || exit 1

mkdir -p logs

LOG="logs/agent.log"
MAX_LOG_BYTES=20971520   # 20 MB

LOG_LINE() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [Talos] $*"; }

if [ ! -f conf/agent.yml ]; then
  LOG_LINE "ERROR: conf/agent.yml not found. Run scripts-linux/install.sh first." >> "$LOG"
  exit 1
fi

JAVA_BIN="$(command -v java 2>/dev/null || true)"
if [ -z "$JAVA_BIN" ]; then
  LOG_LINE "ERROR: java not found on PATH, cannot start the agent." >> "$LOG"
  exit 1
fi

if [ ! -f talos-agent.jar ]; then
  LOG_LINE "ERROR: talos-agent.jar missing, cannot start the agent." >> "$LOG"
  exit 1
fi

# Rotate an oversized log. On Linux an existing writer keeps the old
# inode, so a running agent is not disturbed; the console follows the
# newest agent*.log, which is this freshly renamed one.
if [ -f "$LOG" ]; then
  SIZE="$(wc -c < "$LOG" 2>/dev/null || echo 0)"
  if [ "$SIZE" -gt "$MAX_LOG_BYTES" ]; then
    mv -f "$LOG" "logs/agent-$(date +%Y%m%d%H%M%S).log" 2>/dev/null || true
  fi
fi

LOG_LINE "starting agent (jar $(basename "$(ls -1 talos-agent.jar)"))" >> "$LOG"

# exec: the JVM replaces this shell, so the pid cron tracks is the
# JVM itself and a TERM on it reaches the agent directly.
exec >> "$LOG" 2>&1
exec "$JAVA_BIN" -Dfile.encoding=UTF-8 -Dsun.stdout.encoding=UTF-8 -Dsun.stderr.encoding=UTF-8 \
     -jar talos-agent.jar
