#!/usr/bin/env bash
# Deploy the stewardmd-voice Worker (VoiceCall DO) and push its secrets (read from the existing voice-service
# .env so nothing is re-typed or echoed to chat). Usage: bash voice-worker/deploy.sh [path/to/.env]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ENVF="${1:-$HERE/../voice-service/deploy/.env}"
get() { sed -n "s/^$1=//p" "$ENVF" | head -1; }
WR() { npx --yes wrangler@latest "$@"; }

cd "$HERE"
WR deploy

put() { [ -n "$2" ] && printf '%s' "$2" | WR secret put "$1" >/dev/null && echo "  set $1"; }
put SARVAM_API_KEY "$(get SARVAM_API_KEY)"
put GEMINI_API_KEY "$(get GEMINI_API_KEY)"
put PLIVO_AUTH_ID "$(get PLIVO_AUTH_ID)"
put PLIVO_AUTH_TOKEN "$(get PLIVO_AUTH_TOKEN)"
put PLIVO_FROM "$(get PLIVO_FROM)"
put FOLLOWCARE_VOICE_SERVICE_TOKEN "$(get FOLLOWCARE_VOICE_SERVICE_TOKEN)"
echo "stewardmd-voice deployed + secrets set"
