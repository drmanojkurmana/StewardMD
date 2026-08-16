#!/usr/bin/env bash
# Push the 3 shared secrets to Cloudflare so the run-voice cron can resume the pod and the service token matches.
#   CF_PAGES_PROJECT=<your-pages-project> bash deploy/cloudflare.sh
# Values are read from deploy/.env (same file the pod uses). Run from the repo root or anywhere.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${ENV_FILE:-$HERE/.env}"
: "${CF_PAGES_PROJECT:?set CF_PAGES_PROJECT (your Cloudflare Pages project name)}"
[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE"; exit 1; }

get() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2-; }

for key in FOLLOWCARE_VOICE_SERVICE_TOKEN RUNPOD_API_KEY RUNPOD_POD_ID; do
  val="$(get "$key")"
  if [ -z "$val" ] || [[ "$val" == CHANGE_ME* ]] || [[ "$val" == SET_AUTOMATICALLY* ]]; then
    echo "Skipping $key — not set in $ENV_FILE"; continue
  fi
  echo "Setting Cloudflare secret: $key"
  printf '%s' "$val" | npx wrangler pages secret put "$key" --project-name "$CF_PAGES_PROJECT"
done
echo "Done. (Also set FOLLOWCARE_VOICE_SERVICE_TOKEN on the pod to the SAME value.)"
