#!/usr/bin/env bash
# Strip on-demand module assets from the NATIVE app bundles (iOS + Android) to shrink the install.
# These files are still served by stewardmd.in (and remain in www/ for the web PWA); the module
# loaders fetch them on first use and the WebView caches them. Run AFTER `npx cap sync <platform>`
# and BEFORE the native build. Safe to re-run. See docs/PRODUCTION-RELEASE-RUNBOOK.md.
#
# Each entry is flag-gated OFF by default or has a documented remote fallback, so a device that never
# opens that module never fetches anything, and one that does degrades gracefully to the network.
set -euo pipefail
cd "$(dirname "$0")/.."

# Paths under the native public/ (Capacitor webDir) that are loaded on-demand from stewardmd.in.
ONDEMAND=(
  "assets/vendor/mediapipe"     # FundX face landmarker (WASM + .task) — fundx-detect.js SELF fallback
)

NATIVE_PUBLIC=(
  "ios/App/App/public"
  "android/app/src/main/assets/public"
)

freed=0
for root in "${NATIVE_PUBLIC[@]}"; do
  [ -d "$root" ] || { echo "  (skip, not present: $root)"; continue; }
  for rel in "${ONDEMAND[@]}"; do
    target="$root/$rel"
    if [ -e "$target" ]; then
      sz=$(du -sk "$target" 2>/dev/null | cut -f1)
      rm -rf "$target"
      freed=$((freed + sz))
      echo "  stripped $target (${sz} KB)"
    fi
  done
done
echo "strip-native-ondemand: freed ~$((freed / 1024)) MB from native bundles (still served by stewardmd.in)."
