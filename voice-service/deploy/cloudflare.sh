#!/usr/bin/env bash
# Push the 3 shared secrets to Cloudflare so the run-voice cron can resume the pod and the service token matches.
#   bash deploy/cloudflare.sh
# Targets the StewardMD Pages project. Values are read from deploy/.env (same file the pod uses).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${ENV_FILE:-$HERE/.env}"
# StewardMD's existing Cloudflare Pages project (from wrangler.toml: name = "stewardmd"). Hard-coded so this
# never targets/creates the wrong project; override only with an explicit CF_PAGES_PROJECT for a non-prod project.
CF_PAGES_PROJECT="${CF_PAGES_PROJECT:-stewardmd}"
[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE"; exit 1; }

get() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2-; }

# GEMINI_API_KEY is the AI Studio *fallback* for the shared Gemini transport (Vertex AI stays primary via the
# existing GCP_* config). Voice slot-extraction reuses it — so it lives on Cloudflare, not the GPU box.
for key in FOLLOWCARE_VOICE_SERVICE_TOKEN RUNPOD_API_KEY RUNPOD_POD_ID GEMINI_API_KEY; do
  val="$(get "$key")"
  if [ -z "$val" ] || [[ "$val" == CHANGE_ME* ]] || [[ "$val" == SET_AUTOMATICALLY* ]]; then
    echo "Skipping $key — not set in $ENV_FILE"; continue
  fi
  echo "Setting Cloudflare secret: $key"
  printf '%s' "$val" | npx wrangler pages secret put "$key" --project-name "$CF_PAGES_PROJECT"
done
echo "Done. (Also set FOLLOWCARE_VOICE_SERVICE_TOKEN on the pod to the SAME value.)"
