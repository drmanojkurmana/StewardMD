#!/usr/bin/env bash
# Dump a finished call's persisted dialogue + per-turn timings. Usage: bash voice-worker/kvlog.sh <callId>
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TOK="$(sed -n 's/^FOLLOWCARE_VOICE_SERVICE_TOKEN=//p' "$HERE/../voice-service/deploy/.env" | head -1)"
WORKER="${VOICE_WORKER:-https://stewardmd-voice.drmanojkurmana.workers.dev}"
curl -sS -m 10 "$WORKER/voice/kvlog/$1" -H "X-Voice-Token: $TOK"
