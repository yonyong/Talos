#!/bin/bash
# ============================================================
#  Talos Agent - status (Linux / CentOS)
#
#    scripts-linux/status.sh
#
#  Shows install dir, server config, process state, jar version,
#  keepalive registration and the tail of the newest agent log.
#
#  Keep LF line endings.
# ============================================================
set -u

APP_HOME="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_HOME" || exit 1

PIDFILE="run/agent.pid"

cfg() {
  [ -f conf/agent.yml ] || return 0
  sed -n "s/^ *$1: *//p" conf/agent.yml 2>/dev/null | head -n1 | tr -d '"' | tr -d "'"
}

ADDR="$(cfg addr)"
PORT="$(cfg port)"
HTTPPORT="$(cfg httpPort)"
CID="$(cfg id)"
WS="$(cfg workspace)"
SIGN="$(cfg signSecret)"

echo "============================================"
echo " Talos Agent status"
echo "============================================"
echo " install dir : $APP_HOME"
echo " client id   : ${CID:-<not configured>}"
echo " server grpc : ${ADDR:-?}:${PORT:-?}"
echo " server http : ${ADDR:-?}:${HTTPPORT:-?}"
echo " workspace   : ${WS:-<default>}"
if [ -n "$SIGN" ]; then
  echo " sign secret : set (${#SIGN} chars)"
else
  echo " sign secret : NOT set - tasks are accepted unsigned"
fi

# ---------- jar ----------
if [ -f talos-agent.jar ]; then
  echo " agent jar   : $(wc -c < talos-agent.jar) bytes, $(date -r talos-agent.jar '+%Y-%m-%d %H:%M:%S' 2>/dev/null)"
else
  echo " agent jar   : MISSING - run scripts-linux/install.sh"
fi

# ---------- process ----------
PID=""
if [ -f "$PIDFILE" ]; then
  CAND="$(cat "$PIDFILE" 2>/dev/null | tr -dc '0-9')"
  [ -n "$CAND" ] && kill -0 "$CAND" 2>/dev/null && PID="$CAND"
fi
[ -z "$PID" ] && PID="$(pgrep -f 'talos-agent\.jar' 2>/dev/null | head -n1 || true)"

if [ -n "$PID" ]; then
  echo " process     : RUNNING, pid $PID"
  echo " started at  : $(ps -o lstart= -p "$PID" 2>/dev/null | sed 's/^ *//')"
  echo " uptime      : $(ps -o etime= -p "$PID" 2>/dev/null | sed 's/^ *//')"
else
  echo " process     : NOT RUNNING"
fi

# ---------- keepalive ----------
if command -v crontab >/dev/null 2>&1; then
  if crontab -l 2>/dev/null | grep -q -F "scripts-linux/run-agent.sh"; then
    echo " keepalive   : registered (every 5 minutes)"
  else
    echo " keepalive   : not registered - agent will NOT auto-restart"
  fi
else
  echo " keepalive   : crontab unavailable on this host"
fi

# ---------- instance lock ----------
if [ -f logs/.talos-agent.lock ]; then
  echo " instance lock: present (a single instance is enforced)"
fi

# ---------- tail ----------
echo "--------------------------------------------"
echo " listen socket (outbound, to the server):"
if command -v ss >/dev/null 2>&1 && [ -n "$PORT" ]; then
  ss -tnp 2>/dev/null | grep -E ":$PORT\b" | head -n 5 || echo "   (no connection)"
fi

echo "--------------------------------------------"
NEWEST="$(ls -1t logs/agent*.log 2>/dev/null | head -n1 || true)"
if [ -n "$NEWEST" ]; then
  echo " last 15 lines of $NEWEST:"
  echo "--------------------------------------------"
  tail -n 15 "$NEWEST"
else
  echo " (no log yet - $APP_HOME/logs)"
fi
echo "============================================"
exit 0
