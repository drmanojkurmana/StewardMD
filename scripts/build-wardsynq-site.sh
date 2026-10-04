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
# Mirrors the root _headers file's four headers and ENFORCES a Content-Security-Policy (owner decision
# 2026-10-04, after OPS-27 shipped it Report-Only). No report endpoint exists (no report-uri/report-to), so
# the policy was checked in a real browser instead: every page this site serves, with the policy enforced and
# a report-uri pointed at a local collector (see the PR for the violations found and what was allowed).
#
#   script-src: 'unsafe-inline' stays. index.html, opd.html and clinic-billing.html each ship inline <script>
#     blocks, and ward.js builds markup with inline onchange= handlers; dropping it needs nonces or hashes
#     and a rewrite of those handlers. 'unsafe-eval' is NOT allowed and nothing needs it.
#   https://www.gstatic.com            the Firebase compat SDK scripts.
#   https://apis.google.com            Firebase signInWithPopup (Google sign-in on the door) loads gapi from here.
#   cdn.jsdelivr.net .../dicomParser.min.js   the DICOM viewer's parser, ONE exact file (not the whole CDN),
#     and it is also pinned by an SRI hash in ward-dicom-viewer.js. Keep this URL equal to PARSER_URL there.
#   frame-src https://stewardmd-498ec.firebaseapp.com   Firebase's sign-in popup helper frame.
#   connect-src https://stewardmd.in   opd.html and clinic-billing.html call the record service directly
#     when served from wardsynq.com (stewardmd.in answers CORS for the wardsynq.com origin). The Firebase
#     hosts are the account sign-in.
#   frame-ancestors 'none' (also in its own always-enforced header) and X-Frame-Options DENY stop clickjacking.
CSP="default-src 'self'; script-src 'self' 'unsafe-inline' https://www.gstatic.com https://apis.google.com https://cdn.jsdelivr.net/npm/dicom-parser@1.8.21/dist/dicomParser.min.js; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' https://stewardmd.in https://www.gstatic.com https://securetoken.googleapis.com https://identitytoolkit.googleapis.com; frame-src 'self' https://stewardmd-498ec.firebaseapp.com; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
printf '/*\n  X-Robots-Tag: noindex\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Referrer-Policy: strict-origin-when-cross-origin\n  Strict-Transport-Security: max-age=31536000; includeSubDomains\n  Permissions-Policy: geolocation=(), camera=(self), microphone=(self), payment=(), nfc=(self)\n  Content-Security-Policy: %s\n  Cache-Control: no-store\n/assets/*\n  ! Cache-Control\n  Cache-Control: public, max-age=604800\n' "$CSP" > "$OUT/_headers"

echo "built $OUT ($(find "$OUT" -type f | wc -l | tr -d ' ') files)"
if [ "${1:-}" = "--deploy" ]; then
  # From INSIDE the output directory, so the repo's wrangler.toml (the stewardmd project and its
  # bindings) is never read for this project.
  cd "$OUT"
  npx --yes --prefix "$ROOT" wrangler pages deploy . --project-name wardsynq --branch main --commit-dirty=true
fi
