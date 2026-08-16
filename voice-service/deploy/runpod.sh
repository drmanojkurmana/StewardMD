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
    START="bash -c 'set -x; cd /workspace; rm -rf StewardMD; set +x; git clone -b ${BRANCH} https://x-access-token:\$GITHUB_TOKEN@${REPO} StewardMD || { echo CLONE_FAILED__token_needs_Contents_Read_on_the_repo; sleep infinity; }; set -x; cd StewardMD/voice-service && pip install -r requirements.txt && exec uvicorn app.main:app --host 0.0.0.0 --port 8080; echo BOOT_FAILED_EXIT_\$?; sleep infinity'"
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
  *) echo "usage: runpod.sh {up|status|down|restart|testcall|queue}"; exit 1;;
esac
