#!/bin/bash
# ============================================================
#  Talos Server - install the unpacked package onto this host
#
#    bin/deploy.sh [TARGET] [--user USER] [--keep-config]
#
#    TARGET         install dir, default /opt/applications/talos
#    --user USER    chown the install dir to USER (e.g. talos)
#    --keep-config  do not overwrite an existing config/ directory
#
#  Run this from inside the unpacked package. If the package is
#  already sitting in TARGET, only initialisation is performed.
#
#  Keep LF line endings.
# ============================================================
set -u

SRC="$(cd "$(dirname "$0")/.." && pwd)"

TARGET="/opt/applications/talos"
OWNER=""
KEEP_CONFIG=0

while [ $# -gt 0 ]; do
  case "$1" in
    --user)        OWNER="${2:-}"; shift 2 ;;
    --keep-config) KEEP_CONFIG=1; shift ;;
    -h|--help)
      echo "Usage: bin/deploy.sh [TARGET] [--user USER] [--keep-config]"
      exit 0 ;;
    *)             TARGET="$1"; shift ;;
  esac
done

echo "[Talos] ============================================"
echo "[Talos]  Talos Server deploy"
echo "[Talos]  from : $SRC"
echo "[Talos]  to   : $TARGET"
echo "[Talos] ============================================"

# ---------- 1/5 java ----------
JAVA_BIN="$(command -v java 2>/dev/null || true)"
if [ -z "$JAVA_BIN" ]; then
  echo "[Talos] ERROR: java not found on PATH. Install JDK/JRE 17+ first."
  exit 1
fi
JVER="$("$JAVA_BIN" -version 2>&1 | head -n1 | sed -n 's/.*version "\([0-9][0-9]*\).*/\1/p')"
[ -z "$JVER" ] && JVER=0
if [ "$JVER" -lt 17 ]; then
  echo "[Talos] ERROR: JDK 17+ required, found: $("$JAVA_BIN" -version 2>&1 | head -n1)"
  echo "[Talos] Install it, e.g.: yum install -y java-17-openjdk-headless"
  exit 1
fi
echo "[Talos] 1/5 java OK: $("$JAVA_BIN" -version 2>&1 | head -n1)"

# ---------- 2/5 copy files ----------
if [ "$(readlink -f "$SRC")" != "$(readlink -f "$TARGET" 2>/dev/null || echo "$TARGET")" ]; then
  mkdir -p "$TARGET" || { echo "[Talos] ERROR: cannot create $TARGET"; exit 1; }
  echo "[Talos] 2/5 copying files ..."
  # never clobber a running server's data dir with an empty one
  if [ "$KEEP_CONFIG" -eq 1 ] && [ -d "$TARGET/config" ]; then
    echo "[Talos]      keeping existing config/ (--keep-config)"
    cp -a "$SRC/." "$TARGET/" 2>/dev/null || true
    cp -a "$SRC/config/application.yml" "$TARGET/config/application.yml.new" 2>/dev/null || true
  else
    cp -a "$SRC/." "$TARGET/"
  fi
else
  echo "[Talos] 2/5 package already in place, skipping copy"
fi

cd "$TARGET" || exit 1

# ---------- 3/5 dirs + permissions ----------
echo "[Talos] 3/5 preparing directories ..."
mkdir -p logs run data data/docs app/backup config releases
chmod 755 bin/*.sh 2>/dev/null || true
[ -f config/env.sh ] && chmod 600 config/env.sh

# ---------- 4/5 jar check ----------
echo "[Talos] 4/5 checking jar ..."
JAR="$(ls -1 app/talos-server-*.jar 2>/dev/null | grep -v original | head -n1)"
if [ -z "$JAR" ]; then
  echo "[Talos] ERROR: no app/talos-server-*.jar in the package."
  exit 1
fi
echo "[Talos]      $JAR ($(wc -c < "$JAR") bytes)"

# ---------- 5/5 ownership ----------
if [ -n "$OWNER" ]; then
  if id "$OWNER" >/dev/null 2>&1; then
    echo "[Talos] 5/5 chown -R $OWNER:$OWNER $TARGET"
    chown -R "$OWNER:$OWNER" "$TARGET"
  else
    echo "[Talos] 5/5 WARNING: user '$OWNER' does not exist, ownership unchanged."
  fi
else
  echo "[Talos] 5/5 ownership unchanged (pass --user USER to change it)"
fi

echo "[Talos] ============================================"
echo "[Talos]  Installed to $TARGET"
echo "[Talos]"
echo "[Talos]  Next steps:"
echo "[Talos]    1. edit config/application.yml and config/env.sh"
echo "[Talos]       (ports, LLM key, task-sign secret)"
echo "[Talos]    2. open the firewall ports:"
echo "[Talos]       firewall-cmd --permanent --add-port=\${TALOS_HTTP_PORT:-8080}/tcp"
echo "[Talos]       firewall-cmd --permanent --add-port=\${TALOS_GRPC_PORT:-9443}/tcp"
echo "[Talos]       firewall-cmd --reload"
echo "[Talos]    3. start it:  bin/start.sh"
echo "[Talos]    4. check it:  bin/status.sh"
echo "[Talos] ============================================"
exit 0
