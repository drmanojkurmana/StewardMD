#!/usr/bin/env bash
# Place a live FollowCare voice call via the stewardmd-voice Worker (Cloudflare DO). No RunPod.
#   bash voice-worker/call.sh [E164-phone] [call-payload.json]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ENVF="$HERE/../voice-service/deploy/.env"
WORKER="${VOICE_WORKER:-https://stewardmd-voice.drmanojkurmana.workers.dev}"
TOK="$(sed -n 's/^FOLLOWCARE_VOICE_SERVICE_TOKEN=//p' "$ENVF" | head -1)"
PHONE="${1:-918897298117}"
QJSON="${2:-/Users/diwakarkumar/.claude/jobs/110cfde4/tmp/queue.json}"
CID="c-$(date +%s)"
BODY="$(jq -c --arg ph "$PHONE" --arg cid "$CID" '{call:(.calls[0] + {lang:"te", callId:$cid}), phone:$ph}' "$QJSON")"
curl -sS -m 60 -X POST "$WORKER/voice/originate" \
  -H "Content-Type: application/json" -H "X-Voice-Token: $TOK" -d "$BODY"; echo
