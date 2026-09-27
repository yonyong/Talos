#!/bin/bash
# ============================================================
#  Talos Server - status
#
#    bin/status.sh
#
#  Prints install dir, version, configured ports, process state,
#  listening sockets, an HTTP probe and the tail of the log.
#
#  Keep LF line endings.
# ============================================================
set -u

APP_HOME="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_HOME"

PIDFILE="run/server.pid"
LOG="logs/server.log"

if [ -f config/env.sh ]; then
  # shellcheck source=/dev/null
  . config/env.sh
fi
HTTP_PORT="${TALOS_HTTP_PORT:-8080}"
GRPC_PORT="${TALOS_GRPC_PORT:-9443}"

JAR="$(ls -1 app/talos-server-*.jar 2>/dev/null | grep -v original | head -n1)"
VER="$(basename "${JAR:-unknown}" | sed -n 's/^talos-server-\(.*\)\.jar$/\1/p')"

echo "============================================"
echo " Talos Server status"
echo "============================================"
echo " install dir : $APP_HOME"
echo " version     : ${VER:-unknown}"
if [ -n "$JAR" ]; then
  echo " jar         : $JAR ($(wc -c < "$JAR" 2>/dev/null) bytes)"
else
  echo " jar         : MISSING - run bin/deploy.sh"
fi
echo " ports       : $HTTP_PORT http / $GRPC_PORT grpc"

# ---------- process ----------
PID=""
if [ -f "$PIDFILE" ]; then
  CAND="$(cat "$PIDFILE" 2>/dev/null | tr -dc '0-9')"
  if [ -n "$CAND" ] && kill -0 "$CAND" 2>/dev/null; then
    PID="$CAND"
  fi
fi
if [ -z "$PID" ]; then
  # pid file stale or missing: look for the jar by name
  PID="$(pgrep -f 'talos-server-.*\.jar' 2>/dev/null | head -n1 || true)"
fi

if [ -n "$PID" ]; then
  echo " process     : RUNNING, pid $PID"
  echo " started at  : $(ps -o lstart= -p "$PID" 2>/dev/null | sed 's/^ *//')"
  echo " uptime      : $(ps -o etime= -p "$PID" 2>/dev/null | sed 's/^ *//')"
  if command -v pmap >/dev/null 2>&1; then
    echo " rss         : $(ps -o rss= -p "$PID" 2>/dev/null | awk '{printf "%.1f MB\n", $1/1024}')"
  fi
else
  echo " process     : NOT RUNNING"
fi

# ---------- ports ----------
echo "--------------------------------------------"
echo " listening sockets:"
if command -v ss >/dev/null 2>&1; then
  ss -lntp 2>/dev/null | grep -E ":($HTTP_PORT|$GRPC_PORT)\b" || echo "   (none)"
elif command -v netstat >/dev/null 2>&1; then
  netstat -lntp 2>/dev/null | grep -E ":($HTTP_PORT|$GRPC_PORT)\b" || echo "   (none)"
else
  echo "   (neither ss nor netstat available)"
fi

# ---------- http probe ----------
if command -v curl >/dev/null 2>&1; then
  CODE="$(curl -s -o /dev/null -m 5 -w '%{http_code}' "http://127.0.0.1:$HTTP_PORT/" 2>/dev/null)"
  echo " HTTP /      : ${CODE:-no-response}"
elif command -v wget >/dev/null 2>&1; then
  if wget -q -T 5 -O /dev/null "http://127.0.0.1:$HTTP_PORT/" 2>/dev/null; then
    echo " HTTP /      : 200"
  else
    echo " HTTP /      : no-response"
  fi
else
  echo " HTTP /      : (no curl/wget available)"
fi

# ---------- data ----------
echo "--------------------------------------------"
echo " data dir    : $(du -sh data 2>/dev/null | awk '{print $1}')  ($APP_HOME/data)"
ls -1 data/*.mv.db 2>/dev/null | while read -r f; do
  echo "   db        : $(basename "$f") $(wc -c < "$f") bytes"
done

# ---------- log ----------
echo "--------------------------------------------"
echo " last 15 lines of $LOG:"
echo "--------------------------------------------"
if [ -f "$LOG" ]; then
  tail -n 15 "$LOG"
else
  echo " (no log yet)"
fi
echo "============================================"
exit 0
