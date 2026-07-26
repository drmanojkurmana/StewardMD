#!/usr/bin/env bash
# Disable Cloudflare HTTP/3 (QUIC) for stewardmd.in.
#
# WHY: MaiK's /explain request stalls on the iPhone 17 Pro (new N1 wireless chip) — in the app
# AND in plain Safari — while the SAME iOS 26.5.2 works on an iPad Mini 6, and the backend answers
# in ~0.46s over HTTP/2. The domain advertises `alt-svc: h3=":443"`, so WebKit/URLSession flip
# later requests to HTTP/3/QUIC over UDP, which the 17 Pro's radio (or the network) is dropping.
# Turning HTTP/3 off makes every client stay on HTTP/2 (proven fast), removing the stall — with
# zero app/phone changes and fully reversible.
#
# USAGE:
#   1. Create a token at https://dash.cloudflare.com/profile/api-tokens
#      Template "Edit zone settings" (needs: Zone > Zone Settings > Edit, and Zone > Zone > Read).
#   2. export CF_ZONE_TOKEN=xxxxxxxx
#   3. bash scripts/cf-disable-http3.sh          # disables HTTP/3
#      bash scripts/cf-disable-http3.sh on       # re-enables it (rollback)
set -euo pipefail

DOMAIN="stewardmd.in"
VALUE="${1:-off}"   # "off" (default) or "on"

if [ -z "${CF_ZONE_TOKEN:-}" ]; then
  echo "ERROR: set CF_ZONE_TOKEN (a token with Zone Settings:Edit + Zone:Read)." >&2
  exit 1
fi

api() { curl -sS -H "Authorization: Bearer ${CF_ZONE_TOKEN}" -H "Content-Type: application/json" "$@"; }

echo "→ Resolving zone id for ${DOMAIN} …"
ZONE_ID="$(api "https://api.cloudflare.com/client/v4/zones?name=${DOMAIN}" | python3 -c 'import sys,json;d=json.load(sys.stdin);print((d.get("result") or [{}])[0].get("id",""))')"
if [ -z "$ZONE_ID" ]; then echo "ERROR: could not resolve zone (check token perms/domain)." >&2; exit 1; fi
echo "  zone id: ${ZONE_ID}"

echo "→ Current HTTP/3 setting:"
api "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/settings/http3" | python3 -c 'import sys,json;d=json.load(sys.stdin);print("  http3 =", (d.get("result") or {}).get("value"))'

echo "→ Setting HTTP/3 = ${VALUE} …"
RESP="$(api -X PATCH "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/settings/http3" --data "{\"value\":\"${VALUE}\"}")"
echo "$RESP" | python3 -c 'import sys,json;d=json.load(sys.stdin);ok=d.get("success");print("  success =",ok,"| http3 =",(d.get("result") or {}).get("value"));import sys;sys.exit(0 if ok else 1)'

echo "→ Verifying alt-svc no longer advertises h3 (may take ~30s to propagate):"
curl -sS -D - -o /dev/null "https://${DOMAIN}/" | grep -i "^alt-svc" || echo "  (no alt-svc header — HTTP/3 not advertised) ✅"
echo "Done. Retest MaiK on the iPhone 17 Pro."
