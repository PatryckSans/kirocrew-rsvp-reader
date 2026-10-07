#!/usr/bin/env bash
# Starts the real backend over throw-away sessions, runs the UI integration tests, stops it.
#   cd tests/ui-integration && npm install && bash run.sh
# Needs the gateway's Python (it ships aiohttp): override with GW_PYTHON=/path/to/python3.
set -u
cd "$(dirname "$0")"
GW_PYTHON="${GW_PYTHON:-$(ls /tmp/.mount_*/resources/backend-dist/kirocrew-backend/bin/python3.12 2>/dev/null | head -1)}"
[ -x "$GW_PYTHON" ] || { echo "no gateway python found; set GW_PYTHON"; exit 2; }
export SESS_DIR="$PWD/data/sessions"
rm -rf data && mkdir -p "$SESS_DIR"
"$GW_PYTHON" serve.py > serve.log 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null' EXIT
for _ in $(seq 1 30); do curl -sf 127.0.0.1:8791/health >/dev/null && break; sleep 0.3; done
# --test-force-exit / --test-timeout: a failing test can never hang the run
timeout 300 node --test --test-force-exit --test-timeout=60000 ui.test.mjs
