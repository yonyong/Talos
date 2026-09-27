#!/bin/bash
# ============================================================
#  Talos Agent - upgrade to the server's current release
#
#    scripts-linux/upgrade.sh
#
#  Asks the server (GET /api/agent/release) which version is
#  current, downloads it, verifies SHA256, then stops the agent,
#  replaces the jar and starts it again.
#
#  The agent can also upgrade itself silently: the server pushes a
#  COMMAND UPGRADE over the reverse connection and the agent runs
#  the same replacement in the background.
#
#  Keep LF line endings.
# ============================================================
set -u

APP_HOME="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_HOME" || exit 1

cfg() {
  [ -f conf/agent.yml ] || return 0
  sed -n "s/^ *$1: *//p" conf/agent.yml 2>/dev/null | head -n1 | tr -d '"' | tr -d "'"
}

# pull a flat "key":value out of a small JSON object without jq
json_val() {
  echo "$1" | tr ',' '\n' | grep -F "\"$2\"" | head -n1 | sed 's/.*: *//; s/^"//; s/"$//' | tr -d '\r'
}

ADDR="$(cfg addr)";     [ -z "$ADDR" ] && ADDR="localhost"
HTTPPORT="$(cfg httpPort)"; [ -z "$HTTPPORT" ] && HTTPPORT="8080"
BASE="http://$ADDR:$HTTPPORT"

if command -v curl >/dev/null 2>&1; then
  FETCH() { curl -s -m 30 "$1"; }
  DOWNLOAD() { curl -fsS -m 300 -o "$2" "$1"; }
elif command -v wget >/dev/null 2>&1; then
  FETCH() { wget -q -T 30 -O - "$1"; }
  DOWNLOAD() { wget -q -T 300 -O "$2" "$1"; }
else
  echo "[Talos] ERROR: neither curl nor wget is available."
  exit 1
fi

echo "============================================"
echo " Talos Agent upgrade"
echo " server : $BASE"
echo "============================================"

# ---------- 1/5 ask the server ----------
echo "[Talos] 1/5 checking the current release ..."
META="$(FETCH "$BASE/api/agent/release" 2>/dev/null || true)"
if [ -z "$META" ]; then
  echo "[Talos] ERROR: cannot reach $BASE/api/agent/release"
  exit 1
fi

AVAIL="$(json_val "$META" available)"
TVER="$(json_val "$META" version)"
TSHA="$(json_val "$META" sha256)"
TURL="$(json_val "$META" downloadUrl)"

if [ "$AVAIL" != "true" ]; then
  echo "[Talos] ERROR: the server has no agent release package."
  echo "[Talos]        Put talos-agent.jar into the server's release-dir."
  exit 1
fi
echo "[Talos]     latest version: $TVER"

case "$TURL" in
  http*) DL="$TURL" ;;
  *)     DL="$BASE$TURL" ;;
esac

mkdir -p upgrade
NEWJAR="upgrade/talos-agent-$TVER.jar"

# ---------- 2/5 download ----------
echo "[Talos] 2/5 downloading $DL ..."
if ! DOWNLOAD "$DL" "$NEWJAR"; then
  echo "[Talos] ERROR: download failed."
  exit 1
fi
echo "[Talos]     saved to $NEWJAR ($(wc -c < "$NEWJAR") bytes)"

# ---------- 3/5 verify ----------
echo "[Talos] 3/5 verifying SHA256 ..."
if command -v sha256sum >/dev/null 2>&1; then
  ACT="$(sha256sum "$NEWJAR" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  ACT="$(shasum -a 256 "$NEWJAR" | awk '{print $1}')"
else
  echo "[Talos]     WARNING: no sha256 tool available, skipping verification."
  ACT="$TSHA"
fi

if [ -n "$TSHA" ] && [ "$ACT" != "$TSHA" ]; then
  echo "[Talos] ERROR: checksum mismatch, refusing to install."
  echo "[Talos]   expected $TSHA"
  echo "[Talos]   actual   $ACT"
  rm -f "$NEWJAR"
  exit 1
fi
echo "[Talos]     checksum OK"

# ---------- 4/5 stop + swap ----------
echo "[Talos] 4/5 stopping and replacing ..."
bash "$APP_HOME/scripts-linux/stop.sh" >/dev/null 2>&1 || true

if [ -f talos-agent.jar ]; then
  cp -f talos-agent.jar "upgrade/backup-talos-agent.jar"
  echo "[Talos]     previous jar backed up to upgrade/backup-talos-agent.jar"
fi

if ! cp -f "$NEWJAR" talos-agent.jar; then
  echo "[Talos] ERROR: could not replace talos-agent.jar."
  echo "[Talos]        The staged package is kept at $NEWJAR"
  echo "[Talos]        Recover with: scripts-linux/stop.sh && scripts-linux/upgrade.sh"
  exit 1
fi
rm -f "$NEWJAR"
rm -f logs/.talos-agent.lock
echo "[Talos]     talos-agent.jar replaced"

# ---------- 5/5 start ----------
echo "[Talos] 5/5 starting the new version ..."
bash "$APP_HOME/scripts-linux/start.sh"
RC=$?

echo "[Talos] done. Verify with scripts-linux/status.sh"
exit $RC
