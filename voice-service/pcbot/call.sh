#!/usr/bin/env bash
# Place a test call via the local server. Usage: bash pcbot/call.sh [phone] [lang] [disease] [day]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TOK="$(sed -n 's/^FOLLOWCARE_VOICE_SERVICE_TOKEN=//p' "$HERE/../deploy/.env" | head -1)"
PHONE="${1:-918897298117}"; LG="${2:-te}"; DISEASE="${3:-heart failure}"; DAY="${4:-3}"
curl -sS -m 30 -X POST http://localhost:7860/originate \
  -H "Content-Type: application/json" -H "X-Voice-Token: $TOK" \
  -d "{\"phone\":\"$PHONE\",\"lang\":\"$LG\",\"disease\":\"$DISEASE\",\"dayOffset\":$DAY}"
echo
