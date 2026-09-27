#!/bin/bash
# ============================================================
#  Talos Server - stop
#
#    bin/stop.sh [--force]
#
#  Stops the server recorded in run/server.pid. If that pid is
#  gone or was never written, it falls back to whoever LISTENS
#  on the configured ports, and only kills it when the process
#  command line really belongs to this installation.
#
#  Keep LF line endings.
# ============================================================
set -u

APP_HOME="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_HOME"

PIDFILE="run/server.pid"
FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

if [ -f config/env.sh ]; then
  # shellcheck source=/dev/null
  . config/env.sh
fi
HTTP_PORT="${TALOS_HTTP_PORT:-8080}"
GRPC_PORT="${TALOS_GRPC_PORT:-9443}"

echo "[Talos] stopping Talos Server ..."

is_our_java() {
  # $1 = pid ; true when /proc/<pid>/cmdline mentions our jar
  [ -r "/proc/$1/cmdline" ] || return 1
  tr '\0' ' ' < "/proc/$1/cmdline" 2>/dev/null | grep -q 'talos-server'
}

pids_on_port() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -lntp 2>/dev/null | awk -v p=":$port" '$4 ~ p"$" {print $NF}' \
      | grep -o 'pid=[0-9]*' | cut -d= -f2
  elif command -v netstat >/dev/null 2>&1; then
    netstat -lntp 2>/dev/null | awk -v p=":$port" '$4 ~ p"$" {print $NF}' \
      | sed -n 's|.*/||p' | grep '^[0-9]*$'
  fi
}

stop_pid() {
  local pid="$1"
  if ! kill -0 "$pid" 2>/dev/null; then
    return 0
  fi
  echo "[Talos]   sending TERM to pid $pid"
  kill "$pid" 2>/dev/null || true
  local n=0
  while [ "$n" -lt 30 ]; do
    kill -0 "$pid" 2>/dev/null || { echo "[Talos]   pid $pid stopped"; return 0; }
    n=$((n + 1))
    sleep 1
  done
  if [ "$FORCE" -eq 1 ]; then
    echo "[Talos]   still alive after 30s, sending KILL"
    kill -9 "$pid" 2>/dev/null || true
    sleep 1
  fi
  kill -0 "$pid" 2>/dev/null && return 1
  return 0
}

STOPPED=0
FAILED=0

# ---------- 1) the recorded pid ----------
if [ -f "$PIDFILE" ]; then
  PID="$(cat "$PIDFILE" 2>/dev/null | tr -dc '0-9')"
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    if is_our_java "$PID"; then
      stop_pid "$PID" || FAILED=1
      STOPPED=1
    else
      echo "[Talos]   pid $PID from $PIDFILE is not a Talos server, ignoring it"
    fi
  fi
  rm -f "$PIDFILE"
fi

# ---------- 2) fallback: port owners ----------
if [ "$STOPPED" -eq 0 ]; then
  for P in "$HTTP_PORT" "$GRPC_PORT"; do
    for PID in $(pids_on_port "$P"); do
      [ -z "$PID" ] && continue
      if is_our_java "$PID"; then
        echo "[Talos]   port $P held by pid $PID (our jar)"
        stop_pid "$PID" || FAILED=1
        STOPPED=1
      else
        echo "[Talos]   port $P held by pid $PID - NOT our jar, skipped"
      fi
    done
  done
fi

if [ "$STOPPED" -eq 0 ]; then
  echo "[Talos] nothing to stop - server is not running."
fi

if [ "$FAILED" -eq 1 ]; then
  echo "[Talos] WARNING: a process did not exit. Re-run with --force to KILL it."
  exit 1
fi

# ---------- 3) confirm the ports are free ----------
sleep 1
for P in "$HTTP_PORT" "$GRPC_PORT"; do
  if [ -n "$(pids_on_port "$P")" ]; then
    echo "[Talos] WARNING: port $P is still held. Re-run with --force."
    exit 1
  fi
done
echo "[Talos] stopped. ports $HTTP_PORT / $GRPC_PORT are free."
exit 0
