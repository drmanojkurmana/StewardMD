#!/usr/bin/env bash
# Dump a call's dialogue from the VoiceCall DO. Usage: bash voice-worker/debug.sh <callId>
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TOK="$(sed -n 's/^FOLLOWCARE_VOICE_SERVICE_TOKEN=//p' "$HERE/../voice-service/deploy/.env" | head -1)"
WORKER="${VOICE_WORKER:-https://stewardmd-voice.drmanojkurmana.workers.dev}"
curl -sS -m 10 "$WORKER/voice/debug/$1" -H "X-Voice-Token: $TOK"
