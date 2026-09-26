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
# The patient and family portal (P2.9): its own page, no staff session. portal.js rides the *.js copy below.
cp "$ROOT/wardsynq/site/portal.html" "$OUT/portal.html"
cp "$ROOT/wardsynq/site/_worker.js" "$OUT/_worker.js"
cp "$ROOT/wardsynq/site/"*.js "$ROOT/wardsynq/site/"*.css "$ROOT/wardsynq/site/"*.webmanifest "$OUT/wardsynq/site/"
rm -f "$OUT/wardsynq/site/_worker.js"
cp -R "$ROOT/wardsynq/site/pages" "$OUT/wardsynq/site/pages"
# Per-language catalogs (D6): one file per language, loaded on demand by portal.js's switcher.
cp -R "$ROOT/wardsynq/site/i18n" "$OUT/wardsynq/site/i18n"

# The clinical surfaces, byte-identical to what the app runs.
# discharge.css was missing from this list until 2026-09-12. discharge.js shipped without it, so the
# discharge summary rendered on wardsynq.com with NO stylesheet at all: no card layout, no
# positioning (it fell into normal page flow underneath the ward overlay and looked like it had not
# opened), every Material Symbols ligature printed as its own name — "medicationMedications",
# "fact_checkProvenance" — and the print stylesheet was absent, which is why the printed PDF came out
# as unstyled running text. One file, four symptoms.
for f in hospital-auth.js ward.js ward-offline.js ward-labels.js ward-dicom-viewer.js opd-pulse-model.js opd-offline-desk.js opd-live.js opd-dashboard.js opd-dashboard.css ward.css discharge.js discharge.css patient-register.js patient-register.css opd.html opd-display.html clinic-billing.html; do
  cp "$ROOT/$f" "$OUT/$f"
done
# The QR encoder (MIT, vendored) the Patients page draws ABDM Scan and Share counter QR codes with.
mkdir -p "$OUT/vendor" && cp "$ROOT/vendor/qrcode-generator.js" "$OUT/vendor/qrcode-generator.js"
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
# OPS-06/F6: this ships the SAME clinical surfaces the StewardMD app ships (ward.js, discharge.js,
# patient-register.js, the OPD console, the order-safety workstation), but until now had none of the
# four headers the root _headers file (stewardmd.in) already carries. With no X-Frame-Options/
# frame-ancestors, an attacker could <iframe> a ward board or a critical-result acknowledgement screen
# and mount a clickjacking/UI-redress attack against a logged-in clinician (auth here is header/token
# via localStorage, not cookies, so a framed page still renders the signed-in state). Missing HSTS
# means a hospital-WiFi downgrade attempt on a first-touch connection is not blocked by the browser.
# Mirrors the root _headers file's four headers, plus frame-ancestors 'none' (enforced - simple and
# safe even without a full script-src policy) and a Report-Only CSP derived from what index.html/
# portal.html actually load (Google Fonts, gstatic Firebase, same-origin /api/* via _worker.js's
# server-side proxy - never called cross-origin from the browser). Report-Only, not enforced: index.html
# ships one inline <script> (the SAME reason the root _headers file gives for shipping no CSP there at
# all), so a script-src CSP here risks breaking the app without a nonce - see "Decisions to confirm".
CSP_RO="default-src 'self'; script-src 'self' 'unsafe-inline' https://www.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' https://www.gstatic.com https://securetoken.googleapis.com https://identitytoolkit.googleapis.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
printf '/*\n  X-Robots-Tag: noindex\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Referrer-Policy: strict-origin-when-cross-origin\n  Strict-Transport-Security: max-age=31536000; includeSubDomains\n  Permissions-Policy: geolocation=(), camera=(self), microphone=(self), payment=(), nfc=(self)\n  Content-Security-Policy: frame-ancestors '\''none'\''\n  Content-Security-Policy-Report-Only: %s\n  Cache-Control: no-store\n/assets/*\n  ! Cache-Control\n  Cache-Control: public, max-age=604800\n' "$CSP_RO" > "$OUT/_headers"

echo "built $OUT ($(find "$OUT" -type f | wc -l | tr -d ' ') files)"
if [ "${1:-}" = "--deploy" ]; then
  # From INSIDE the output directory, so the repo's wrangler.toml (the stewardmd project and its
  # bindings) is never read for this project.
  cd "$OUT"
  npx --yes --prefix "$ROOT" wrangler pages deploy . --project-name wardsynq --branch main --commit-dirty=true
fi
