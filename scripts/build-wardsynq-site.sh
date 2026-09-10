#!/usr/bin/env bash
# scripts/build-wardsynq-site.sh - assemble and (optionally) deploy wardsynq.com.
#
# wardsynq.com is the Cloudflare Pages project "wardsynq" (direct upload, no git build). This script
# copies the door (wardsynq/site), the SAME clinical surfaces the StewardMD app ships (ward.js,
# discharge.js, patient-register.js, the OPD console, the order-safety workstation) and the assets
# they load into dist-wardsynq/, then `wrangler pages deploy` publishes it. /api/* is forwarded to
# stewardmd.in by dist-wardsynq/_worker.js, so nothing here needs a binding.
#
#   scripts/build-wardsynq-site.sh            build only
#   scripts/build-wardsynq-site.sh --deploy   build and publish to wardsynq.com
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/dist-wardsynq"
rm -rf "$OUT"
mkdir -p "$OUT/wardsynq/site" "$OUT/wardsynq/ui" "$OUT/wardsynq/adapters" "$OUT/wardsynq/data" "$OUT/assets/fonts" "$OUT/data" "$OUT/kb/protocols"

cp "$ROOT/wardsynq/site/index.html" "$OUT/index.html"
cp "$ROOT/wardsynq/site/_worker.js" "$OUT/_worker.js"
cp "$ROOT/wardsynq/site/"*.js "$ROOT/wardsynq/site/"*.css "$ROOT/wardsynq/site/"*.webmanifest "$OUT/wardsynq/site/"
rm -f "$OUT/wardsynq/site/_worker.js"
cp -R "$ROOT/wardsynq/site/pages" "$OUT/wardsynq/site/pages"

# The clinical surfaces, byte-identical to what the app runs.
for f in ward.js ward.css discharge.js patient-register.js patient-register.css opd.html opd-display.html; do
  cp "$ROOT/$f" "$OUT/$f"
done
# The order-safety workstation and the WardSynQ client libraries it imports.
cp "$ROOT/wardsynq/ui/"* "$OUT/wardsynq/ui/" 2>/dev/null || true
cp -R "$ROOT/wardsynq/ui/brand" "$OUT/wardsynq/ui/brand"
cp "$ROOT/wardsynq/"*.js "$OUT/wardsynq/"
cp "$ROOT/wardsynq/adapters/"*.js "$OUT/wardsynq/adapters/"
cp "$ROOT/wardsynq/data/"*.json "$OUT/wardsynq/data/"
cp "$ROOT/data/interaction-rules.json" "$OUT/data/"
# Fonts the ward, the OPD console and the door self-host (no CDN at first paint).
cp "$ROOT/assets/fonts/"*.woff2 "$OUT/assets/fonts/"
# Oncology protocol templates the OPD console loads client-side.
cp "$ROOT/kb/protocols/"*.json "$OUT/kb/protocols/" 2>/dev/null || true

# Nothing under this site is a public page.
printf '/*\n  X-Robots-Tag: noindex\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  Cache-Control: no-store\n/assets/*\n  ! Cache-Control\n  Cache-Control: public, max-age=604800\n' > "$OUT/_headers"

echo "built $OUT ($(find "$OUT" -type f | wc -l | tr -d ' ') files)"
if [ "${1:-}" = "--deploy" ]; then
  cd "$ROOT"
  npx wrangler pages deploy "$OUT" --project-name wardsynq --branch main --commit-dirty=true
fi
