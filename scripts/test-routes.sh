#!/usr/bin/env bash
# Start `wrangler dev` (local only, no Cloudflare account needed) against dist/ and curl every route.
# Usage: scripts/test-routes.sh [port]   (run `npm run build` first)
set -u
PORT=${1:-8787}
BASE="http://127.0.0.1:$PORT"
export NO_PROXY="127.0.0.1,localhost,${NO_PROXY:-}" no_proxy="127.0.0.1,localhost,${no_proxy:-}"
LOG=$(mktemp)
npx wrangler dev --ip 127.0.0.1 --port "$PORT" --log-level warn >"$LOG" 2>&1 &
PID=$!
cleanup() { kill "$PID" 2>/dev/null; sleep 1; pkill -P "$PID" 2>/dev/null; pkill -f "workerd.*$PORT" 2>/dev/null; rm -f "$LOG"; }
trap cleanup EXIT
for i in $(seq 1 60); do curl -s -o /dev/null "$BASE/" && break; sleep 1; done
if ! curl -s -o /dev/null "$BASE/"; then echo "wrangler dev did not start"; cat "$LOG"; exit 1; fi

fail=0
check() { # path expected_status [expected_location]
  local p=$1 want=$2 loc=${3:-}
  local out; out=$(curl -s -o /dev/null -w '%{http_code} %{content_type} %{redirect_url}' "$BASE$p")
  local code=${out%% *}
  local ok=PASS
  [ "$code" = "$want" ] || ok=FAIL
  if [ -n "$loc" ] && [[ "$out" != *"$loc"* ]]; then ok=FAIL; fi
  [ $ok = FAIL ] && fail=1
  printf '%-4s %-28s -> %s\n' "$ok" "$p" "$out"
}
echo "== pages (200) =="
for p in / /download /changelog /docs /privacy /licenses /en/ /en/download /en/changelog /en/docs /en/privacy /en/licenses; do check "$p" 200; done
echo "== trailing-slash / .html normalisation (redirects) =="
check /download/ 307 "$BASE/download"
check /en 307 "$BASE/en/"
check /en/docs/ 307 "$BASE/en/docs"
check /download.html 307 "$BASE/download"
check /index.html 307 "$BASE/"
echo "== static files =="
for p in /favicon.svg /robots.txt; do check "$p" 200; done
CSS=$(grep -o '/assets/site\.[0-9a-f]*\.css' dist/index.html | head -1)
JS=$(grep -o '/assets/site\.[0-9a-f]*\.js' dist/index.html | head -1)
check "$CSS" 200; check "$JS" 200
echo "== unknown paths (404 page) =="
check /nope 404; check /en/nope 404; check /download/extra 404; check /assets/missing.css 404
body=$(curl -s "$BASE/does-not-exist")
if [[ "$body" == *"页面不存在"* && "$body" == *"Page not found"* ]]; then echo "PASS 404 body is the bilingual 404 page"; else echo "FAIL 404 body"; fail=1; fi
echo "== response headers (/ and $CSS) =="
curl -s -D - -o /dev/null "$BASE/" | grep -iE '^(content-type|content-security-policy|x-content-type-options|referrer-policy|permissions-policy|x-frame-options|cache-control|cross-origin-opener-policy):' | tr -d '\r'
curl -s -D - -o /dev/null "$BASE$CSS" | grep -iE '^(content-type|cache-control):' | tr -d '\r'
curl -s -D - -o /dev/null "$BASE/nope" | grep -iE '^(content-type|cache-control):' | tr -d '\r'
for h in content-security-policy x-content-type-options referrer-policy permissions-policy; do
  curl -s -D - -o /dev/null "$BASE/en/download" | grep -qi "^$h:" || { echo "FAIL header $h missing on /en/download"; fail=1; }
done
curl -s -D - -o /dev/null "$BASE$CSS" | grep -qi 'immutable' || { echo "FAIL hashed CSS not immutable"; fail=1; }
echo "== direct refresh (same request twice) =="
a=$(curl -s "$BASE/en/privacy" | sha256sum); b=$(curl -s "$BASE/en/privacy" | sha256sum)
[ "$a" = "$b" ] && echo "PASS repeated GET /en/privacy identical" || { echo "FAIL refresh differs"; fail=1; }
[ $fail = 0 ] && echo "ROUTES: ALL PASS" || echo "ROUTES: FAILURES"
exit $fail
