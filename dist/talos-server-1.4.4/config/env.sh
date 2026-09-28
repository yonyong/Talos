#!/bin/bash
# ============================================================
#  Talos Server - environment (read by bin/*.sh)
#
#  Every setting here becomes an environment variable and is
#  picked up by config/application.yml through ${VAR:default}.
#  Edit this file, then restart the server.
#
#  SECURITY: this file holds secrets. Keep it mode 600 and owned
#  by the account that runs the server.
#     chmod 600 config/env.sh
# ============================================================

# ---------- ports ----------
# Console / REST / embedded SPA
export TALOS_HTTP_PORT=8080
# Client reverse long connection (gRPC)
export TALOS_GRPC_PORT=9443

# ---------- JVM ----------
export TALOS_JAVA_OPTS="-Xms256m -Xmx1024m -XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/opt/applications/talos/logs -Dfile.encoding=UTF-8 -Duser.timezone=Asia/Shanghai"
# Seconds bin/start.sh waits for the port before giving up
export TALOS_START_TIMEOUT=90

# ---------- database (H2 file, lives in data/) ----------
export TALOS_DB_PATH=/opt/applications/talos/data/talosdb
export TALOS_DB_USER=sa
export TALOS_DB_PASSWORD=talos

# ---------- SECURITY: change both before going live ----------
# HMAC key for task dispatch. MUST equal client signSecret in
# conf/agent.yml on every agent, otherwise agents reject tasks.
export TALOS_SIGN_SECRET=talos-dev-secret

# ---------- server-side LLM (admission / sorting / QA) ----------
export TALOS_LLM_PROVIDER=qwen
export TALOS_LLM_KEY=
export TALOS_LLM_MODEL=qwen-max
export TALOS_LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
# true  = run the flow even without a model, mark results for review
# false = strict fail-safe: no model means nothing is admitted
export TALOS_FALLBACK_ALLOW_ADMIT=true

# ---------- private inference (code-related prompts) ----------
export TALOS_PRIVATE_MODEL_ENABLED=true
export TALOS_PRIVATE_MODEL_BASE_URL=http://codebuddy.internal/v1
export TALOS_PRIVATE_MODEL_NAME=cb-internal

# ---------- paths ----------
export TALOS_DOC_DIR=/opt/applications/talos/data/docs
export TALOS_AGENT_RELEASE_DIR=/opt/applications/talos/releases
export TALOS_LOG_FILE=/opt/applications/talos/logs/server.log
export TALOS_LOG_LEVEL=INFO

# ---------- console address reachable by agents ----------
# Filled into download links for agent packages. Leave empty to let
# each agent use the address it dialled in with.
export TALOS_PUBLIC_BASE_URL=
export TALOS_AUTO_UPGRADE=true
