#!/bin/bash
# ============================================================
#  Talos Server - start
#
#    bin/start.sh
#
#  Starts the server as a background process, records its pid in
#  run/server.pid and waits until the process is really listening.
#  Idempotent: starting an already running server is a no-op.
#
#  This file must keep LF line endings. If it ever gets CRLF
#  (edited on Windows), run:  sed -i 's/\r$//' bin/*.sh
# ============================================================
set -u

APP_HOME="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_HOME"

PIDFILE="run/server.pid"
LOG="logs/server.log"
MAX_LOG_BYTES=20971520   # 20 MB, rotate on start

# ---------- load external settings (ports, secrets) ----------
if [ -f config/env.sh ]; then
  # shellcheck source=/dev/null
  . config/env.sh
fi

HTTP_PORT="${TALOS_HTTP_PORT:-8080}"
GRPC_PORT="${TALOS_GRPC_PORT:-9443}"
JAVA_OPTS="${TALOS_JAVA_OPTS:--Xms256m -Xmx1024m -Dfile.encoding=UTF-8}"
START_TIMEOUT="${TALOS_START_TIMEOUT:-90}"

echo "[Talos] ============================================"
echo "[Talos]  Talos Server  start"
echo "[Talos]  home : $APP_HOME"
echo "[Talos]  http : $HTTP_PORT    grpc : $GRPC_PORT"
echo "[Talos] ============================================"

# ---------- 1/5 java ----------
JAVA_BIN="$(command -v java 2>/dev/null || true)"
if [ -z "$JAVA_BIN" ]; then
  echo "[Talos] ERROR: java not found on PATH. Install JDK/JRE 17+ and retry."
  exit 1
fi
JVER="$("$JAVA_BIN" -version 2>&1 | head -n1 | sed -n 's/.*version "\([0-9][0-9]*\).*/\1/p')"
[ -z "$JVER" ] && JVER=0
if [ "$JVER" -lt 17 ]; then
  echo "[Talos] ERROR: JDK 17+ required, found: $("$JAVA_BIN" -version 2>&1 | head -n1)"
  exit 1
fi

# ---------- 2/5 jar ----------
JAR="$(ls -1 app/talos-server-*.jar 2>/dev/null | grep -v original | head -n1)"
if [ -z "$JAR" ]; then
  echo "[Talos] ERROR: server jar not found in $APP_HOME/app"
  exit 1
fi

# ---------- 3/5 already running? ----------
if [ -f "$PIDFILE" ]; then
  OLD="$(cat "$PIDFILE" 2>/dev/null | tr -dc '0-9')"
  if [ -n "$OLD" ] && kill -0 "$OLD" 2>/dev/null; then
    if tr '\0' ' ' < "/proc/$OLD/cmdline" 2>/dev/null | grep -q 'talos-server'; then
      echo "[Talos] already running, pid $OLD - nothing to do."
      echo "[Talos]   status : bin/status.sh"
      echo "[Talos]   stop   : bin/stop.sh"
      exit 0
    fi
  fi
  rm -f "$PIDFILE"
fi

mkdir -p logs run data app/backup

# ---------- 4/5 rotate an oversized log, then launch ----------
if [ -f "$LOG" ]; then
  SIZE="$(wc -c < "$LOG" 2>/dev/null || echo 0)"
  if [ "$SIZE" -gt "$MAX_LOG_BYTES" ]; then
    mv -f "$LOG" "$LOG.$(date +%Y%m%d%H%M%S)"
    echo "[Talos] previous log rotated ($SIZE bytes)"
  fi
fi

# SERVER__PORT is the relaxed-binding env form of server.port and would
# override application.yml. Drop it; the value comes from config/env.sh.
unset SERVER__PORT
unset SERVER_PORT

echo "[Talos] starting: java $JAVA_OPTS -jar $JAR"
# shellcheck disable=SC2086
nohup "$JAVA_BIN" $JAVA_OPTS -jar "$JAR" \
  --server.port="$HTTP_PORT" \
  --grpc.server.port="$GRPC_PORT" \
  >> "$LOG" 2>&1 &
PID=$!
echo "$PID" > "$PIDFILE"
echo "[Talos] pid $PID recorded in $PIDFILE"

# ---------- 5/5 wait for it to come up ----------
port_listening() {
  if command -v ss >/dev/null 2>&1; then
    ss -lnt 2>/dev/null | awk '{print $4}' | grep -q ":$1\$"
  elif command -v netstat >/dev/null 2>&1; then
    netstat -lnt 2>/dev/null | awk '{print $4}' | grep -q ":$1\$"
  else
    return 1
  fi
}

echo "[Talos] waiting for port $HTTP_PORT (up to ${START_TIMEOUT}s) ..."
i=0
while [ "$i" -lt "$START_TIMEOUT" ]; do
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "[Talos] ERROR: process exited during startup. Last log lines:"
    tail -n 30 "$LOG" 2>/dev/null
    rm -f "$PIDFILE"
    exit 1
  fi
  if grep -q "Started TalosApplication" "$LOG" 2>/dev/null || port_listening "$HTTP_PORT"; then
    echo "[Talos] ============================================"
    echo "[Talos]  Started. pid $PID"
    echo "[Talos]    console : http://<this-host>:$HTTP_PORT/"
    echo "[Talos]    grpc    : <this-host>:$GRPC_PORT"
    echo "[Talos]    log     : $APP_HOME/$LOG"
    echo "[Talos]    stop    : bin/stop.sh"
    echo "[Talos] ============================================"
    exit 0
  fi
  i=$((i + 1))
  sleep 1
done

echo "[Talos] WARNING: port $HTTP_PORT not listening after ${START_TIMEOUT}s."
echo "[Talos] The process is still running (pid $PID) - check the log:"
echo "[Talos]   tail -n 50 $LOG"
exit 1
