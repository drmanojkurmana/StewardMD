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
IMAGE="${RUNPOD_IMAGE:-runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04}"

: "${RUNPOD_API_KEY:?set RUNPOD_API_KEY in your shell (do NOT paste it into chat)}"
command -v jq >/dev/null || { echo "This script needs jq (brew install jq)."; exit 1; }
GQL="https://api.runpod.io/graphql?api_key=${RUNPOD_API_KEY}"
gql() { curl -sS -X POST "$GQL" -H "Content-Type: application/json" -d "$1"; }

cmd="${1:-up}"
case "$cmd" in
  up)
    [ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE — copy deploy/.env.example to deploy/.env and fill it in."; exit 1; }
    : "${GITHUB_TOKEN:?set GITHUB_TOKEN (a read-only GitHub PAT) so the pod can clone the private repo}"
    # env array from .env: split each line on the FIRST '=' (values may contain '='); append GITHUB_TOKEN.
    ENVJSON=$(grep -vE '^[[:space:]]*(#|$)' "$ENV_FILE" \
      | jq -R 'capture("^(?<k>[^=]+)=(?<v>.*)$") | {key:.k, value:.v}' \
      | jq -s --arg t "$GITHUB_TOKEN" '. + [{key:"GITHUB_TOKEN", value:$t}]')
    # Pod start command: clone + install + run. $GITHUB_TOKEN is kept literal here and expands in the pod.
    START="bash -lc 'cd /workspace && (test -d StewardMD || git clone -b ${BRANCH} https://\$GITHUB_TOKEN@${REPO} StewardMD) && cd StewardMD/voice-service && pip install -r requirements.txt && uvicorn app.main:app --host 0.0.0.0 --port 8080'"
    Q='mutation($env:[EnvironmentInput!], $args:String, $g:String!, $img:String!){ podFindAndDeployOnDemand(input:{ cloudType: SECURE, gpuCount: 1, gpuTypeId: $g, name: "stewardmd-followcare-voice", imageName: $img, containerDiskInGb: 30, volumeInGb: 40, volumeMountPath: "/models", ports: "8080/http", minMemoryInGb: 24, minVcpuCount: 4, dockerArgs: $args, env: $env }){ id machineId } }'
    BODY=$(jq -n --argjson env "$ENVJSON" --arg args "$START" --arg g "$GPU_TYPE" --arg img "$IMAGE" --arg q "$Q" \
      '{query:$q, variables:{env:$env, args:$args, g:$g, img:$img}}')
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
  *) echo "usage: runpod.sh {up|status|down}"; exit 1;;
esac
