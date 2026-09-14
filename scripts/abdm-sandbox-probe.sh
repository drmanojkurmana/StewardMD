#!/bin/bash
# scripts/abdm-sandbox-probe.sh — talk to the live ABDM sandbox and capture what it actually answers.
#
# WHY THIS EXISTS. Every defect D1-D8 in this module came from writing against the spec without the
# spec. This script is how a claim becomes evidence: it posts a real body to the real gateway and
# records the real answer, so a note in a doc can cite something re-runnable rather than a memory.
#
# CREDENTIALS live OUTSIDE the repo at ~/.stewardmd-secrets/abdm-sandbox.env (mode 600) and are sourced,
# never printed. Nothing here writes a secret to stdout, a file, or a log.
#
# SAFE BY DEFAULT: every probe targets a deliberately nonexistent @sbx address, so no real patient is
# ever sent a consent request. Pass a real address only when you mean to (see `flow` below).
#
# Usage:
#   ./scripts/abdm-sandbox-probe.sh session          # prove the credentials work
#   ./scripts/abdm-sandbox-probe.sh bridge           # what URL is registered right now
#   ./scripts/abdm-sandbox-probe.sh set-url <url>    # re-register the callback BASE url (no path!)
#   ./scripts/abdm-sandbox-probe.sh consent-matrix   # which consent-init fields the gateway enforces
#   ./scripts/abdm-sandbox-probe.sh flow <abha@sbx>  # drive the real flows against a REAL address
set -euo pipefail

ENVFILE="${ABDM_ENVFILE:-$HOME/.stewardmd-secrets/abdm-sandbox.env}"
[ -r "$ENVFILE" ] || { echo "no credentials at $ENVFILE" >&2; exit 1; }
set -a; . "$ENVFILE"; set +a

uuid() { python3 -c "import uuid;print(uuid.uuid4())"; }
# ABDM wants zero-UTC ISO with exactly milliseconds (FAQ Q6).
ts() { python3 -c "import datetime as d;n=d.datetime.now(d.UTC);print(n.strftime('%Y-%m-%dT%H:%M:%S.')+'%03dZ'%(n.microsecond//1000))"; }

session() {
  curl -s --max-time 30 -X POST "$ABDM_BASE/api/hiecm/gateway/v3/sessions" \
    -H "content-type: application/json" -H "REQUEST-ID: $(uuid)" -H "TIMESTAMP: $(ts)" -H "X-CM-ID: $ABDM_CM_ID" \
    -d "{\"clientId\":\"$ABDM_CLIENT_ID\",\"clientSecret\":\"$ABDM_CLIENT_SECRET\",\"grantType\":\"client_credentials\"}"
}
tok() { session | python3 -c "import sys,json;print(json.load(sys.stdin)['accessToken'])"; }

# call <METHOD> <PATH> <BODYFILE|-> [extra curl args...]
call() {
  local m="$1" p="$2" b="$3"; shift 3
  local a=(-s --max-time 30 -X "$m" "$ABDM_BASE$p"
    -H "authorization: Bearer $TOKEN" -H "content-type: application/json"
    -H "REQUEST-ID: $(uuid)" -H "TIMESTAMP: $(ts)" -H "X-CM-ID: $ABDM_CM_ID")
  [ "$b" != "-" ] && a+=(--data @"$b")
  curl "${a[@]}" "$@"
}

PROBE_ADDR="${PROBE_ADDR:-stewardmd-probe-does-not-exist@sbx}"

consent_body() {  # consent_body <abhaAddress> > file
  # The permission window ENDS NOW, deliberately. A hardcoded `to` made every run byte-identical, so the
  # second one came back ABDM-1070 "Duplicate consent request" and no callback ever fired again - a probe
  # you can only run once is not a probe. Found 2026-08-20 re-triggering after the D14 fix.
  python3 - "$1" <<'PY'
import json,sys,datetime as d
now=d.datetime.now(d.UTC).strftime('%Y-%m-%dT%H:%M:%S.')+'%03dZ'%(d.datetime.now(d.UTC).microsecond//1000)
print(json.dumps({"consent":{
 "purpose":{"text":"Care Management","code":"CAREMGT","refUri":"https://www.nhs.uk/"},
 "patient":{"id":sys.argv[1]},
 "hiu":{"id":"__HIU__"},
 "hip":None,"careContexts":None,
 "requester":{"name":"Dr Probe","identifier":{"type":"REGNO","value":"AP12345","system":"https://www.mciindia.org"}},
 "hiTypes":["OPConsultation"],
 "permission":{"accessMode":"VIEW",
   "dateRange":{"from":"2026-01-01T00:00:00.000Z","to":now},
   "dataEraseAt":"2026-12-31T00:00:00.000Z",
   "frequency":{"unit":"HOUR","value":0,"repeats":0}}}}))
PY
}

cmd="${1:-session}"
case "$cmd" in
  session)
    session | python3 -c "import sys,json;d=json.load(sys.stdin);print('OK keys:',sorted(d.keys()));print('expiresIn:',d.get('expiresIn'),'tokenType:',d.get('tokenType'))"
    ;;
  bridge)
    TOKEN=$(tok); call GET /api/hiecm/gateway/v3/bridge-services - | python3 -c "import sys,json;print(json.dumps(json.load(sys.stdin),indent=2))"
    ;;
  set-url)
    [ -n "${2:-}" ] || { echo "usage: set-url <https://host>   (BASE ONLY - a path makes the gateway append it twice, FAQ Q30)" >&2; exit 2; }
    # FAQ Q30: register the BASE only - a path makes the gateway append the endpoint twice. Count path
    # segments AFTER the scheme; the earlier check counted the "https://" slashes and so rejected every
    # legitimate https://host/segment base, including a webhook.site URL.
    nopath="${2#*://}"
    case "$nopath" in
      */*/*) echo "refusing: '$2' has more than one path segment. Register the BASE only (FAQ Q30)." >&2; exit 2;;
    esac
    TOKEN=$(tok)
    printf '{"url":"%s"}' "$2" > /tmp/abdm-url.json
    call PATCH /api/hiecm/gateway/v3/bridge/url /tmp/abdm-url.json -w "\nHTTP:%{http_code}\n"
    rm -f /tmp/abdm-url.json
    echo "--- read back ---"
    call GET /api/hiecm/gateway/v3/bridge-services - | python3 -c "import sys,json;print(json.load(sys.stdin)['bridge']['url'])"
    ;;
  consent-matrix)
    # Remove one field at a time and record what the gateway complains about. A body that reaches
    # subject resolution answers "User not found" => that field is NOT required.
    TOKEN=$(tok)
    D=$(mktemp -d); consent_body "$PROBE_ADDR" | sed "s/__HIU__/$ABDM_HIU_ID/" > "$D/full.json"
    python3 - "$D" <<'PY'
import json,copy,sys,os
D=sys.argv[1]; base=json.load(open(os.path.join(D,"full.json")))
def w(n,mut):
    d=copy.deepcopy(base); mut(d["consent"]); json.dump(d,open(os.path.join(D,n),"w"))
w("no_hiu.json",       lambda c: c.pop("hiu"))
w("no_requester.json", lambda c: c.pop("requester"))
w("no_access.json",    lambda c: c["permission"].pop("accessMode"))
w("no_freq.json",      lambda c: c["permission"].pop("frequency"))
w("no_nulls.json",     lambda c: (c.pop("hip"), c.pop("careContexts")))
w("no_hitypes.json",   lambda c: c.pop("hiTypes"))
w("no_purpose.json",   lambda c: c.pop("purpose"))
PY
    echo "'User not found' => the body PASSED validation (that field is not required)."
    for f in full no_hiu no_requester no_access no_freq no_nulls no_hitypes no_purpose; do
      printf '%-16s %s\n' "$f" "$(call POST /api/hiecm/consent/v3/request/init "$D/$f.json" -H "X-HIU-ID: $ABDM_HIU_ID" -w ' [HTTP:%{http_code}]')"
    done
    rm -rf "$D"
    ;;
  flow)
    ADDR="${2:-}"; [ -n "$ADDR" ] || { echo "usage: flow <abha-address@sbx>   (a REAL sandbox address - it will receive a consent request)" >&2; exit 2; }
    TOKEN=$(tok); D=$(mktemp -d)
    consent_body "$ADDR" | sed "s/__HIU__/$ABDM_HIU_ID/" > "$D/c.json"
    echo "=== consent request init -> expect 202 + an async on-init callback ==="
    call POST /api/hiecm/consent/v3/request/init "$D/c.json" -H "X-HIU-ID: $ABDM_HIU_ID" -w "\nHTTP:%{http_code}\n"
    echo
    echo "=== link-token generate (demographic auth) -> expect an async on-generate-token callback ==="
    printf '{"abhaAddress":"%s","name":"%s","gender":"%s","yearOfBirth":%s}\n' \
      "$ADDR" "${PROBE_NAME:-Probe Patient}" "${PROBE_GENDER:-M}" "${PROBE_YOB:-1985}" > "$D/t.json"
    call POST /api/hiecm/v3/token/generate-token "$D/t.json" -H "X-HIP-ID: $ABDM_HIP_ID" -w "\nHTTP:%{http_code}\n"
    rm -rf "$D"
    echo
    echo "Now poll the capture endpoint for the callbacks."
    ;;
  *) echo "unknown command: $cmd" >&2; exit 2;;
esac
