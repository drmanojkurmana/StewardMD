#!/bin/bash
# scripts/abdm-local-receiver.sh — run the REAL V3 receiver where ABDM can reach it, without deploying.
#
# THE WALL THIS REMOVES. Ten of the fifteen callback kinds only fire after we ANSWER one. webhook.site
# records and never answers, so the gateway times out ("StewardMD is taking longer than expected") and
# link/care-context/init and /confirm never arrive at all. Capturing them needs a receiver that replies -
# which until now meant deploying to production with CONNECT_HIP_FLAG=1 against fifteen unverified
# parsers. That is exactly the move that produced D4, D6, D4b and D4c.
#
# So: run the receiver on localhost instead, behind a cloudflared quick tunnel.
#
#   ABDM  --https-->  <random>.trycloudflare.com  -->  :8787 abdm-bridge.py  (records the raw body)
#                                                            |
#                                                            v
#                                                      :8788 wrangler pages dev  (the real handlers,
#                                                            CONNECT_FLAG=1 CONNECT_HIP_FLAG=1)
#
# The flag is set in ONE LOCAL PROCESS. Production is untouched, D1/KV/R2 are all local scratch, and
# teardown is ctrl-C. Every raw body is still recorded, so scripts/abdm-capture.py works as before.
#
# Usage:
#   ./scripts/abdm-local-receiver.sh              # start everything, print the URL to register
#   ./scripts/abdm-local-receiver.sh --register   # ...and re-point the ABDM bridge at it automatically
#
# Then, in a second terminal:
#   export ABDM_CAPTURE_API='http://127.0.0.1:8787/token/%s/requests'
#   ./scripts/abdm-capture.py local --expect server-driven      # proves the tunnel + registration work
#   ./scripts/abdm-sandbox-probe.sh flow <abha@sbx>             # trigger
#
# WHEN YOU ARE DONE, put the registration back:
#   ./scripts/abdm-sandbox-probe.sh set-url https://webhook.site/<token>
# A quick-tunnel hostname dies with this process, and a bridge pointing at a dead host means every
# callback ABDM sends is lost with no error anywhere.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENVFILE="${ABDM_ENVFILE:-$HOME/.stewardmd-secrets/abdm-sandbox.env}"
STATE="${ABDM_LOCAL_DIR:-$HOME/.cache/stewardmd-abdm-local}"
PORT_BRIDGE="${ABDM_BRIDGE_PORT:-8787}"
PORT_RECV="${ABDM_RECV_PORT:-8788}"
REGISTER=0
[ "${1:-}" = "--register" ] && REGISTER=1

for c in cloudflared wrangler python3; do
  command -v "$c" >/dev/null || { echo "missing: $c" >&2; exit 1; }
done
[ -r "$ENVFILE" ] || { echo "no credentials at $ENVFILE" >&2; exit 1; }
set -a; . "$ENVFILE"; set +a

mkdir -p "$STATE/project/public" "$STATE/logs"
ln -sfn "$REPO/functions" "$STATE/project/functions"

# A Pages project of our own, so the production wrangler.toml (and its real database_id) is never loaded.
# Every binding below is LOCAL scratch: nothing here can reach the live stewardmd-connect D1.
cat > "$STATE/project/wrangler.jsonc" <<'JSON'
{
  "name": "abdm-local-receiver",
  "compatibility_date": "2026-06-28",
  "compatibility_flags": ["nodejs_compat"],
  "pages_build_output_dir": "public",
  "d1_databases": [{ "binding": "CONNECT_DB", "database_name": "abdm-local", "database_id": "local-abdm-capture" }],
  "kv_namespaces": [{ "binding": "MAIK_KV", "id": "local-abdm-kv" }],
  "r2_buckets": [{ "binding": "CONNECT_R2", "bucket_name": "abdm-local-r2" }]
}
JSON

# Scratch data gets a scratch key. It never leaves this machine and nothing it seals is kept.
[ -f "$STATE/master.key" ] || { openssl rand -base64 32 > "$STATE/master.key"; chmod 600 "$STATE/master.key"; }
MASTER_KEY="$(cat "$STATE/master.key")"

if [ ! -f "$STATE/.schema-applied" ]; then
  echo "== applying connect schema to the local D1 =="
  for f in db/connect_schema.sql db/connect_abdm_schema.sql; do
    ( cd "$STATE/project" && wrangler d1 execute CONNECT_DB --local --persist-to "$STATE/wstate" \
        --file "$REPO/$f" >>"$STATE/logs/d1.log" 2>&1 ) \
      && echo "   ok   $f" || { echo "   FAIL $f - see $STATE/logs/d1.log" >&2; exit 1; }
  done
  touch "$STATE/.schema-applied"
fi

PIDS=()
cleanup() {
  echo; echo "== stopping =="
  for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done
  if [ "$REGISTER" = "1" ]; then cat <<'WARN'

The tunnel is gone, so the URL registered on the ABDM bridge no longer resolves. Point it back before
anything else runs:   ./scripts/abdm-sandbox-probe.sh set-url https://webhook.site/<token>
WARN
  fi
  exit 0
}
trap cleanup INT TERM

# 1. Tunnel first: the receiver needs its own public URL as ABDM_CALLBACK_BASE, and a quick tunnel's
#    hostname is only knowable once it is up.
echo "== starting cloudflared quick tunnel =="
: > "$STATE/logs/tunnel.log"
cloudflared tunnel --url "http://localhost:$PORT_BRIDGE" --no-autoupdate >>"$STATE/logs/tunnel.log" 2>&1 &
PIDS+=($!)
PUBLIC=""
for _ in $(seq 1 40); do
  PUBLIC="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$STATE/logs/tunnel.log" 2>/dev/null | head -1 || true)"
  [ -n "$PUBLIC" ] && break
  sleep 1
done
[ -n "$PUBLIC" ] || { echo "tunnel did not come up - see $STATE/logs/tunnel.log" >&2; cleanup; }
echo "   $PUBLIC"

# 2. The receiver. CONNECT_HIP_FLAG=1 lives here and only here - one local process, not an environment.
echo "== starting the receiver on :$PORT_RECV =="
( cd "$STATE/project" && wrangler pages dev public --port "$PORT_RECV" --persist-to "$STATE/wstate" \
    --binding \
      CONNECT_FLAG=1 \
      CONNECT_HIP_FLAG=1 \
      CONNECT_MASTER_KEY="$MASTER_KEY" \
      ABDM_ENV="${ABDM_ENV:-sandbox}" \
      ABDM_BASE="${ABDM_BASE:-}" \
      ABDM_ABHA_BASE="${ABDM_ABHA_BASE:-}" \
      ABDM_CM_ID="${ABDM_CM_ID:-}" \
      ABDM_HIP_ID="${ABDM_HIP_ID:-}" \
      ABDM_HIU_ID="${ABDM_HIU_ID:-}" \
      ABDM_CLIENT_ID="${ABDM_CLIENT_ID:-}" \
      ABDM_CLIENT_SECRET="${ABDM_CLIENT_SECRET:-}" \
      ABDM_CALLBACK_BASE="$PUBLIC" \
    >>"$STATE/logs/receiver.log" 2>&1 ) &
PIDS+=($!)

# 3. The recorder, in front of it.
echo "== starting the bridge on :$PORT_BRIDGE =="
ABDM_BRIDGE_LOG="$STATE/callbacks.jsonl" python3 "$REPO/scripts/abdm-bridge.py" \
  --port "$PORT_BRIDGE" --upstream "127.0.0.1:$PORT_RECV" &
PIDS+=($!)

# 4. Readiness: a 401 means the receiver is up, routing, and refusing an unsigned body - which is
#    exactly what it should do. A 000/404 means it is not serving yet.
echo "== waiting for the receiver =="
READY=0
for _ in $(seq 1 45); do
  code="$(curl -s -o /dev/null -w '%{http_code}' -X POST \
    "http://127.0.0.1:$PORT_BRIDGE/api/v3/hip/patient/care-context/discover" \
    -H 'content-type: application/json' -H "REQUEST-ID: $(uuidgen)" \
    -H "TIMESTAMP: $(date -u +%Y-%m-%dT%H:%M:%S.000Z)" -d '{}' 2>/dev/null || true)"
  [ "$code" = "401" ] && { READY=1; break; }
  sleep 1
done
if [ "$READY" = "1" ]; then
  echo "   ready (401 on an unsigned body, fail-closed)"
else
  echo "   WARNING: receiver not answering 401 yet - see $STATE/logs/receiver.log" >&2
fi

if [ "$REGISTER" = "1" ]; then
  echo "== re-pointing the ABDM bridge at the tunnel =="
  "$REPO/scripts/abdm-sandbox-probe.sh" set-url "$PUBLIC"
else
  echo
  echo "Register this URL when you are ready:"
  echo "   ./scripts/abdm-sandbox-probe.sh set-url $PUBLIC"
fi

cat <<EOF

Callback base : $PUBLIC
Capture API   : http://127.0.0.1:$PORT_BRIDGE/token/local/requests
Raw log       : $STATE/callbacks.jsonl
Receiver log  : $STATE/logs/receiver.log

In another terminal:
   export ABDM_CAPTURE_API='http://127.0.0.1:$PORT_BRIDGE/token/%s/requests'
   ./scripts/abdm-capture.py local --expect server-driven --timeout 300

ctrl-C here to stop everything.
EOF

wait
