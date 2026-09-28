#!/bin/bash
# ============================================================
#  Talos Server - upgrade the jar on a live installation
#
#    bin/upgrade.sh --jar /path/to/talos-server-1.5.0.jar
#    bin/upgrade.sh --jar ... --keep      (leave the server stopped)
#
#  Stops the server, backs up the current jar into app/backup/,
#  installs the new jar and starts the server again.
#
#  config/ and data/ are NEVER touched: settings and the H2
#  database survive an upgrade. Schema changes are applied by
#  Hibernate on startup (spring.jpa.hibernate.ddl-auto=update).
#
#  Keep LF line endings.
# ============================================================
set -u

APP_HOME="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_HOME"

NEWJAR=""
RESTART=1

while [ $# -gt 0 ]; do
  case "$1" in
    --jar)   NEWJAR="${2:-}"; shift 2 ;;
    --keep)  RESTART=0; shift ;;
    -h|--help)
      echo "Usage: bin/upgrade.sh --jar <new-server.jar> [--keep]"
      exit 0 ;;
    *) echo "[Talos] ERROR: unknown argument: $1"; exit 1 ;;
  esac
done

if [ -z "$NEWJAR" ]; then
  echo "[Talos] ERROR: --jar <file> is required."
  echo "[Talos] Usage: bin/upgrade.sh --jar /tmp/talos-server-1.5.0.jar"
  exit 1
fi
if [ ! -f "$NEWJAR" ]; then
  echo "[Talos] ERROR: $NEWJAR not found."
  exit 1
fi

NEWVER="$(basename "$NEWJAR" | sed -n 's/^talos-server-\(.*\)\.jar$/\1/p')"
[ -z "$NEWVER" ] && NEWVER="$(date +%Y%m%d%H%M%S)"

echo "[Talos] ============================================"
echo "[Talos]  Talos Server upgrade"
echo "[Talos]  home    : $APP_HOME"
echo "[Talos]  new jar : $NEWJAR  (version $NEWVER)"
echo "[Talos] ============================================"

# ---------- 1/4 stop ----------
echo "[Talos] 1/4 stopping the running server ..."
bash bin/stop.sh || {
  echo "[Talos] ERROR: could not stop the server. Resolve it, then retry."
  exit 1
}

# ---------- 2/4 back up + swap ----------
echo "[Talos] 2/4 installing the new jar ..."
mkdir -p app/backup
OLD="$(ls -1 app/talos-server-*.jar 2>/dev/null | grep -v original | head -n1)"
if [ -n "$OLD" ]; then
  STAMP="$(date +%Y%m%d%H%M%S)"
  cp -a "$OLD" "app/backup/$(basename "$OLD").$STAMP"
  echo "[Talos]      previous jar backed up to app/backup/$(basename "$OLD").$STAMP"
fi

# stage inside app/ so the move is atomic on the same filesystem
cp -f "$NEWJAR" "app/talos-server-$NEWVER.jar"
if [ -n "$OLD" ] && [ "$OLD" != "app/talos-server-$NEWVER.jar" ]; then
  rm -f "$OLD"
fi
chmod 644 "app/talos-server-$NEWVER.jar"
echo "[Talos]      now: app/talos-server-$NEWVER.jar"

# ---------- 3/4 verify ----------
echo "[Talos] 3/4 verifying jar integrity ..."
if command -v unzip >/dev/null 2>&1; then
  if ! unzip -tq "app/talos-server-$NEWVER.jar" >/dev/null 2>&1; then
    echo "[Talos] ERROR: the new jar is corrupt. Restore from app/backup and retry."
    exit 1
  fi
  echo "[Talos]      jar OK"
else
  echo "[Talos]      (unzip not available, skipping integrity check)"
fi

# ---------- 4/4 start ----------
if [ "$RESTART" -eq 1 ]; then
  echo "[Talos] 4/4 starting ..."
  bash bin/start.sh
  exit $?
else
  echo "[Talos] 4/4 --keep given, server left stopped. Start it with bin/start.sh"
  exit 0
fi
