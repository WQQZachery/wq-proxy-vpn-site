#!/usr/bin/env bash
# Run a command while `wrangler dev` serves dist/ on 127.0.0.1:$PORT (default 8787).
# Example: scripts/with-dev-server.sh node scripts/screenshots.mjs
set -u
PORT=${PORT:-8787}
export NO_PROXY="127.0.0.1,localhost,${NO_PROXY:-}" no_proxy="127.0.0.1,localhost,${no_proxy:-}"
export BASE="http://127.0.0.1:$PORT"
LOG=$(mktemp)
npx wrangler dev --ip 127.0.0.1 --port "$PORT" --log-level warn >"$LOG" 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null; sleep 1; pkill -f "workerd.*$PORT" 2>/dev/null; rm -f "$LOG"' EXIT
for i in $(seq 1 60); do curl -s -o /dev/null "$BASE/" && break; sleep 1; done
"$@"
