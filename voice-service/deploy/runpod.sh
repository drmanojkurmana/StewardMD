#!/usr/bin/env bash
# Provision / control the FollowCare voice-service GPU pod on RunPod.
#   RUNPOD_API_KEY=... GITHUB_TOKEN=... bash deploy/runpod.sh up      # create an on-demand 24GB pod
#   RUNPOD_API_KEY=... RUNPOD_POD_ID=... bash deploy/runpod.sh status
#   RUNPOD_API_KEY=... RUNPOD_POD_ID=... bash deploy/runpod.sh down    # stop (billing pauses)
#
# Secrets come from the ENVIRONMENT + deploy/.env — never hard-code them and never paste them into chat.
# GITHUB_TOKEN = a GitHub PAT with read access to the (private) StewardMD repo, so the pod can clone it.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${ENV_FILE:-$HERE/.env}"
BRANCH="${VOICE_BRANCH:-feat/followcare-voice}"
REPO="${VOICE_REPO:-github.com/drmanojkurmana/StewardMD.git}"
GPU_TYPE="${RUNPOD_GPU_TYPE:-NVIDIA GeForce RTX 3090}"
CLOUD_TYPE="${RUNPOD_CLOUD_TYPE:-COMMUNITY}"   # COMMUNITY = more availability + cheaper; SECURE for stricter isolation
IMAGE="${RUNPOD_IMAGE:-runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04}"
REQ_FILE="${VOICE_REQUIREMENTS:-requirements.txt}"   # full Indic stack (IndicConformer + Parler) for Telugu quality

# Keys may come from the shell OR from ENV_FILE (so `bash runpod.sh up` works after the wizard, no exports).
_envfile_get() { [ -f "$ENV_FILE" ] && sed -n "s/^$1=//p" "$ENV_FILE" | head -1 || true; }
RUNPOD_API_KEY="${RUNPOD_API_KEY:-$(_envfile_get RUNPOD_API_KEY)}"
RUNPOD_POD_ID="${RUNPOD_POD_ID:-$(_envfile_get RUNPOD_POD_ID)}"
: "${RUNPOD_API_KEY:?set RUNPOD_API_KEY (shell or $ENV_FILE)}"
command -v jq >/dev/null || { echo "This script needs jq (brew install jq)."; exit 1; }
GQL="https://api.runpod.io/graphql?api_key=${RUNPOD_API_KEY}"
gql() { curl -sS -X POST "$GQL" -H "Content-Type: application/json" -d "$1"; }

cmd="${1:-up}"
case "$cmd" in
  up)
    [ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE — copy deploy/.env.example to deploy/.env and fill it in."; exit 1; }
    GITHUB_TOKEN="${GITHUB_TOKEN:-$(_envfile_get GITHUB_TOKEN)}"
    : "${GITHUB_TOKEN:?set GITHUB_TOKEN (a read-only GitHub PAT) so the pod can clone the private repo}"
    # env array from .env: split each line on the FIRST '=' (values may contain '='); append GITHUB_TOKEN.
    # Exclude keys the pod must NOT get from here: RunPod injects RUNPOD_POD_ID itself; VOICE_PUBLIC_BASE is
    # derived from it at runtime; GITHUB_TOKEN is appended once below (avoid a duplicate key).
    # env as an INLINE GraphQL object list (unquoted keys, jq-escaped string values) — avoids depending on the
    # exact RunPod input type name. Excludes keys the pod must not get from here; appends GITHUB_TOKEN once.
    ENVGQL=$(grep -vE '^[[:space:]]*(#|$)' "$ENV_FILE" \
      | grep -vE '^(RUNPOD_POD_ID|VOICE_PUBLIC_BASE|GITHUB_TOKEN|GEMINI_API_KEY)=' \
      | jq -R 'capture("^(?<k>[^=]+)=(?<v>.*)$")' \
      | jq -sr --arg t "$GITHUB_TOKEN" '(. + [{k:"GITHUB_TOKEN", v:$t}]) | map("{key:\"\(.k)\",value:\(.v|tojson)}") | join(",")')
    # Pod start command: clone + install + run. Notes: x-access-token: form works for fine-grained PATs;
    # `set -x` traces each step into the container log; a trailing `sleep infinity` keeps the container ALIVE on
    # any failure (no crash loop) so the error is inspectable instead of vanishing. $GITHUB_TOKEN expands in-pod.
    # Sparse/shallow/blobless clone of ONLY voice-service/ — the full repo is 472MB and GitHub throttles it;
    # the pod needs ~1MB. This turns a multi-minute (throttled) clone into a few seconds.
    START="bash -c 'set -x; cd /workspace; rm -rf StewardMD; set +x; git clone --depth 1 --filter=blob:none --sparse -b ${BRANCH} https://x-access-token:\$GITHUB_TOKEN@${REPO} StewardMD && (cd StewardMD && git sparse-checkout set voice-service) || { echo CLONE_FAILED__token_or_sparse; sleep infinity; }; set -x; cd StewardMD/voice-service && pip install -r ${REQ_FILE} && exec uvicorn app.main:app --host 0.0.0.0 --port 8080; echo BOOT_FAILED_EXIT_\$?; sleep infinity'"
    # gpuTypeId/image/dockerArgs as GraphQL String variables; env inlined above.
    Q="mutation(\$args:String, \$g:String!, \$img:String!){ podFindAndDeployOnDemand(input:{ cloudType: ${CLOUD_TYPE}, gpuCount: 1, gpuTypeId: \$g, name: \"stewardmd-followcare-voice\", imageName: \$img, containerDiskInGb: 30, volumeInGb: 40, volumeMountPath: \"/models\", ports: \"8080/http\", minMemoryInGb: 24, minVcpuCount: 4, dockerArgs: \$args, env: [${ENVGQL}] }){ id machineId } }"
    BODY=$(jq -n --arg args "$START" --arg g "$GPU_TYPE" --arg img "$IMAGE" --arg q "$Q" \
      '{query:$q, variables:{args:$args, g:$g, img:$img}}')
    RESP=$(gql "$BODY"); echo "$RESP" | jq .
    PID=$(echo "$RESP" | jq -r '.data.podFindAndDeployOnDemand.id // empty')
    if [ -n "$PID" ]; then
      echo
      echo "POD_ID: $PID"
      echo "Public URL (VOICE_PUBLIC_BASE): https://${PID}-8080.proxy.runpod.net"
      echo "Next: put RUNPOD_POD_ID=$PID and that URL into deploy/.env, then run deploy/cloudflare.sh."
    else
      echo "No pod id returned — see the error above. Common fixes: a different RUNPOD_GPU_TYPE (availability) or region." >&2
      exit 1
    fi
    ;;
  status)
    : "${RUNPOD_POD_ID:?set RUNPOD_POD_ID}"
    gql "$(jq -n --arg id "$RUNPOD_POD_ID" '{query:"query($id:String!){ pod(input:{podId:$id}){ id desiredStatus runtime{ uptimeInSeconds } } }", variables:{id:$id}}')" | jq .
    ;;
  down)
    : "${RUNPOD_POD_ID:?set RUNPOD_POD_ID}"
    gql "$(jq -n --arg id "$RUNPOD_POD_ID" '{query:"mutation($id:String!){ podStop(input:{podId:$id}){ id desiredStatus } }", variables:{id:$id}}')" | jq .
    ;;
  restart)
    # Stop + resume the SAME pod: re-runs the boot (re-clone latest + pip install) but KEEPS the persistent
    # /models volume, so downloaded models are reused (no 10-min re-download). Use to iterate quickly.
    : "${RUNPOD_POD_ID:?set RUNPOD_POD_ID}"
    gql "$(jq -n --arg q "mutation { podStop(input:{podId:\"$RUNPOD_POD_ID\"}){ id desiredStatus } }" '{query:$q}')" >/dev/null
    sleep 8
    gql "$(jq -n --arg q "mutation { podResume(input:{podId:\"$RUNPOD_POD_ID\"}){ id desiredStatus } }" '{query:$q}')" | jq .
    echo "restarted $RUNPOD_POD_ID → https://${RUNPOD_POD_ID}-8080.proxy.runpod.net"
    ;;
  testcall)
    # Fire the owner test call via Cloudflare /voice/test (service-token gated). Args: [phone] [pathwayId].
    BASE="$(_envfile_get FOLLOWCARE_BASE)"; TOK="$(_envfile_get FOLLOWCARE_VOICE_SERVICE_TOKEN)"
    PHONE="${2:-8897298117}"; PW="${3:-heart_failure}"
    curl -sS -X POST "$BASE/voice/test" -H "X-Voice-Token: $TOK" -H "Content-Type: application/json" \
      -d "{\"phone\":\"$PHONE\",\"pathwayId\":\"$PW\",\"name\":\"Test\"}"; echo
    ;;
  queue)
    BASE="$(_envfile_get FOLLOWCARE_BASE)"; TOK="$(_envfile_get FOLLOWCARE_VOICE_SERVICE_TOKEN)"
    curl -sS "$BASE/voice/queue" -H "X-Voice-Token: $TOK"; echo
    ;;
  plivocall)
    # Fast telephony smoke test: dial [phone] directly via Plivo, speaking a test line (no GPU). Args: [phone-E164].
    AID="$(_envfile_get PLIVO_AUTH_ID)"; ATOK="$(_envfile_get PLIVO_AUTH_TOKEN)"; FROM="$(_envfile_get PLIVO_FROM)"
    TO="${2:-918897298117}"
    ANS="https://followcare-voice-proxy.drmanojkurmana.workers.dev/plivo-test-answer"
    curl -sS -X POST "https://api.plivo.com/v1/Account/$AID/Call/" -u "$AID:$ATOK" -H "Content-Type: application/json" \
      -d "{\"from\":\"$FROM\",\"to\":\"$TO\",\"answer_url\":\"$ANS\",\"answer_method\":\"GET\"}"; echo
    ;;
  call)
    # ONE command for a live test: resume the pod if it self-stopped, wait until models are ready, then dial.
    : "${RUNPOD_POD_ID:?set RUNPOD_POD_ID}"
    ST=$(gql "$(jq -n --arg id "$RUNPOD_POD_ID" '{query:"query($id:String!){pod(input:{podId:$id}){desiredStatus}}",variables:{id:$id}}')" | jq -r '.data.pod.desiredStatus // empty')
    if [ "$ST" != "RUNNING" ]; then
      echo "resuming pod $RUNPOD_POD_ID ..."
      gql "$(jq -n --arg q "mutation{podResume(input:{podId:\"$RUNPOD_POD_ID\"}){id}}" '{query:$q}')" >/dev/null
    fi
    echo "waiting for models to load (~2-3 min) ..."
    for i in $(seq 1 90); do
      curl -sS -m 8 "https://${RUNPOD_POD_ID}-8080.proxy.runpod.net/healthz" 2>/dev/null | grep -q '"ready":true' && { echo "ready"; break; }
      sleep 10
    done
    exec bash "$0" ingest
    ;;
  ingest)
    # Relay the queued call to the pod's /ingest. The pod's datacenter IP is 403'd pulling the queue itself,
    # so THIS host (allowed IP) pulls it, attaches the Gemini key for direct slot-extraction, and pushes it.
    BASE="$(_envfile_get FOLLOWCARE_BASE)"; TOK="$(_envfile_get FOLLOWCARE_VOICE_SERVICE_TOKEN)"
    GK="$(_envfile_get GEMINI_API_KEY)"
    : "${RUNPOD_POD_ID:?set RUNPOD_POD_ID}"
    Q=$(curl -sS "$BASE/voice/queue" -H "X-Voice-Token: $TOK")
    [ "$(printf '%s' "$Q" | jq -r '.count // 0')" = "0" ] && { echo "queue empty — run: runpod.sh testcall"; exit 1; }
    # Fresh callId each run (so a re-dial isn't dropped as a duplicate); amd:"" disables machine-detection.
    CID="retry-$(date +%s)"
    BODY=$(printf '%s' "$Q" | jq -c --arg k "$GK" --arg cid "$CID" '{call:(.calls[0] + {callId:$cid, lang:"te"}), geminiKey:$k, amd:""}')
    curl -sS -m 45 -X POST "https://${RUNPOD_POD_ID}-8080.proxy.runpod.net/ingest" \
      -H "Content-Type: application/json" -d "$BODY"; echo
    ;;
  plivostatus)
    # What happened to the recent call(s): ring/answer/hangup cause. Shows why a placed call didn't connect.
    AID="$(_envfile_get PLIVO_AUTH_ID)"; ATOK="$(_envfile_get PLIVO_AUTH_TOKEN)"
    curl -sS -u "$AID:$ATOK" "https://api.plivo.com/v1/Account/$AID/Call/?limit=5" \
      | jq '.objects[] | {to:.to_number, status:.call_state, hangup:.hangup_cause_name, dur:.bill_duration, end:.end_time}'
    ;;
  podinfo)
    : "${RUNPOD_POD_ID:?set RUNPOD_POD_ID}"
    curl -sS -H "Authorization: Bearer $RUNPOD_API_KEY" "https://rest.runpod.io/v1/pods/$RUNPOD_POD_ID"; echo
    ;;
  *) echo "usage: runpod.sh {up|status|down|restart|call|ingest|queue|testcall|plivocall|plivostatus|podinfo}"; exit 1;;
esac
