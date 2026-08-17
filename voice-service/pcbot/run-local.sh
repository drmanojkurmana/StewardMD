#!/usr/bin/env bash
# Start the Pipecat voice server locally. Loads only the needed secrets from ../deploy/.env.
# Usage:  bash pcbot/run-local.sh        (from voice-service/)  -> serves on :7860
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
VS="$(cd "$HERE/.." && pwd)"
set -a
eval "$(grep -E '^(SARVAM_API_KEY|PLIVO_AUTH_ID|PLIVO_AUTH_TOKEN|PLIVO_FROM|FOLLOWCARE_VOICE_SERVICE_TOKEN|FOLLOWCARE_BASE)=' "$VS/deploy/.env")"
set +a
export SARVAM_LLM="${SARVAM_LLM:-sarvam-105b-conversations}"
export SARVAM_TTS_MODEL="${SARVAM_TTS_MODEL:-bulbul:v2}"
export SARVAM_SPEAKER="${SARVAM_SPEAKER:-anushka}"
export SARVAM_STT_MODEL="${SARVAM_STT_MODEL:-saarika:v2.5}"
export SARVAM_PACE="${SARVAM_PACE:-0.9}"
export SARVAM_LOUDNESS="${SARVAM_LOUDNESS:-1.3}"
export VOICE_PUBLIC_BASE="${VOICE_PUBLIC_BASE:-}"
cd "$VS"
exec "$HERE/.venv/bin/uvicorn" server:app --app-dir pcbot --host 0.0.0.0 --port 7860 --log-level info
