#!/usr/bin/env bash
# StewardMD — assemble the Capacitor web bundle (www/).
# The web app is buildless static files at the repo root. Capacitor copies ONE
# folder into the native apps, so this collects ONLY the runtime files (no .git,
# node_modules, docs, store-assets, test, functions, worker, kb source/build inputs).
# Run: npm run build:www   (also invoked by `npm run sync`).
set -euo pipefail
shopt -s nullglob
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WWW="$ROOT/www"
cd "$ROOT"

rm -rf "$WWW"
mkdir -p "$WWW" "$WWW/kb/dist" "$WWW/kb/ai" "$WWW/kb/treatments" "$WWW/kb/protocols"

# ── 1. Shipping HTML (exclude demos + site-verification pages) ────────────────
for f in index.html privacy.html terms.html disclaimer.html support.html copyright.html; do
  [ -f "$f" ] && cp "$f" "$WWW/"
done

# ── 2. All root app JS (buildless app), minus the Capacitor config itself ─────
for f in *.js; do
  case "$f" in
    capacitor.config.js|capacitor.config.ts) : ;;   # native config, not a web asset
    *) cp "$f" "$WWW/" ;;
  esac
done

# ── 2b. Stylesheets (buildless CSS referenced by index.html / home.js) ────────
# index.html + home.js load /ui-v3.css at runtime (the whole .v3/.v4 home layout
# + base font-family live here). On web these are served from the repo root; the
# native bundle must include them or the home renders unstyled (serif + broken).
for f in *.css; do
  cp "$f" "$WWW/"
done

# ── 2d. Vendored libraries (bundled pdf.js) — loaded LOCALLY so PDF import works
# offline / in the native app where the CDN is unreachable (see loadPdfJs in
# icu.js / medlist.js, which try /vendor/pdfjs/ before the CDN fallback). ──────
[ -d vendor ] && cp -R vendor "$WWW/"

# ── 3. Manifest + service worker ──────────────────────────────────────────────
[ -f site.webmanifest ] && cp site.webmanifest "$WWW/"
[ -f sw.js ] && cp sw.js "$WWW/"

# ── 4. Root icons / images ────────────────────────────────────────────────────
for f in *.png *.webp *.ico *.svg *.gif *.jpg *.jpeg; do
  cp "$f" "$WWW/"
done

# ── 4a. Self-hosted fonts (Material Symbols Rounded woff2) — the icon font MUST ship
# in the bundle, else the native WebView can't reach the CDN and every ligature icon
# renders as its text name ("monitor_heart"…). @font-face lives in redesign-system.css. ─
if [ -d assets/fonts ]; then mkdir -p "$WWW/assets/fonts"; cp assets/fonts/* "$WWW/assets/fonts/" 2>/dev/null || true; fi
# Learn-ECG atlas images (bundled ECGs for kardiox-content-pack.js lessons)
# Learn-ECG atlas images (~182 MB, 1,007 lessons) are intentionally NOT bundled — that would
# bloat the native download. They are served on-demand from Pages (stewardmd.in/assets/kardiox-learn);
# kardiox-screens.js rewrites /assets/kardiox-learn/* to the live origin when running natively.
# (To bundle them for full offline use instead, restore the cp here.)

# ── 4a-bis. Vendored third-party assets (e.g. FundX AI's local MediaPipe wasm/model
# under assets/vendor/mediapipe/). Copied recursively so a vendored copy actually ships
# in the bundle + OTA; without this the "vendor locally" path silently 404s at runtime. ─
if [ -d assets/vendor ]; then mkdir -p "$WWW/assets/vendor"; cp -R assets/vendor/. "$WWW/assets/vendor/" 2>/dev/null || true; fi

# ── 4b. Offline clinical bundle (native drug monographs, lazy-loaded by
# offline-clinical.js). Built by scripts/build-offline-clinical.mjs. ────────────
[ -f data/offline-clinical.json.gz ] && cp data/offline-clinical.json.gz "$WWW/"

# ── 4c. WardSynQ clinical surface ─────────────────────────────────────────────
# The EMR surface and the modules it imports. Copied WHOLE rather than cherry-picked:
# these are native ES modules that import each other by relative path, so a partial
# copy produces a surface that loads until it reaches the one module nobody listed.
#
# NOTE: shipping these files does NOT make WardSynQ reachable to a user. Nothing in
# the StewardMD app links to wardsynq.html and no flag turns it on; it is present so
# the offline shell and the assets are cached and testable, not so a clinician can
# open it. Reachability is a separate, deliberate decision that has not been taken.
if [ -d wardsynq ]; then
  mkdir -p "$WWW/wardsynq"
  cp -R wardsynq/. "$WWW/wardsynq/"
  # Test fixtures and seed data used only by node --test are not runtime assets.
  rm -rf "$WWW/wardsynq/data/"*.seed.json.bak 2>/dev/null || true
  echo "  wardsynq: $(find "$WWW/wardsynq" -type f | wc -l | tr -d ' ') files"
fi

# ── 5. Knowledge base — RUNTIME pieces only ───────────────────────────────────
# Loaded by index.html + steward-ai.browser.js; the 13 MB kb.index.json and all
# source/dev dirs (diseases, reference, validation, tools, schema, manifest…) are
# NOT fetched at runtime and are deliberately excluded.
for f in kb/dist/kb.core.js kb/dist/kb.clinical.js kb/dist/kb.enrichment.js \
         kb/dist/kb.enrichment.2.js kb/dist/kb.expanded.js kb/dist/kb.rag.js; do
  [ -f "$f" ] && cp "$f" "$WWW/kb/dist/"
done
[ -d kb/ai ] && cp -R kb/ai/. "$WWW/kb/ai/"
[ -d kb/treatments ] && cp -R kb/treatments/. "$WWW/kb/treatments/"
# Oncology protocol templates (static, plain JSON - same trust tier as kb/treatments, NOT the
# encrypted Pro KB). Fetched directly by the client, no kb-loader.js change (Phase 3).
[ -d kb/protocols ] && cp -R kb/protocols/. "$WWW/kb/protocols/"
# ONCOTREE navigator graphs (static JSON; same trust tier as kb/protocols).
[ -d kb/oncotree ] && mkdir -p "$WWW/kb/oncotree" && cp -R kb/oncotree/. "$WWW/kb/oncotree/"
# Oncology reference catalogs: AJCC/TNM staging index, CTCAE catalog, irAE (IO toxicity) catalog -
# fetched at runtime by onco-staging.js / onco-ctcae.js / onco-iotox.js. (Was missing -> those views
# rendered empty on the device because the data never reached www/.)
[ -d kb/onco ] && mkdir -p "$WWW/kb/onco" && cp -R kb/onco/. "$WWW/kb/onco/"
# MaiK Ask clinical pathways (fetched at runtime by pathways.js SMD_PATHWAYS.loadAll)
# RadioAnatome: ship the JSON but NOT the .webp slices -- those stay on Pages and
# atlas.js rewrites their URLs natively, mirroring kardiox-screens.js kxImg().
if [ -d atlas ]; then
  mkdir -p "$WWW/atlas"
  cp atlas/modules.json "$WWW/atlas/" 2>/dev/null || true
  for d in atlas/*/; do [ -f "$d/atlas.json" ] && mkdir -p "$WWW/$d" && cp "$d/atlas.json" "$WWW/$d"; done
  # 3D layer (atlas3d.js): ship the manifest + canonical index, NOT the 31 MB of .bin.gz
  # geometry -- atlas3d.js dataUrl() fetches those from the live origin natively.
  if [ -d atlas/3d ]; then
    mkdir -p "$WWW/atlas/3d"
    cp atlas/3d/manifest.json atlas/3d/index.json "$WWW/atlas/3d/" 2>/dev/null || true
  fi
fi
[ -d clinical-pathways ] && mkdir -p "$WWW/clinical-pathways" && cp -R clinical-pathways/. "$WWW/clinical-pathways/"
# CliniX clinical-learning content (catalog + skill packs + disease pathways + the media licence
# registry). All plain JSON, fetched at runtime by clinix-content.js on first open. This copy is
# load-bearing: without it the module loads, the tile appears, and every pathway renders empty on the
# device - exactly the kb/onco failure recorded above. Media assets are NOT copied: like
# assets/kardiox-learn/, they stay on Pages and clinix-content.js cxMedia() rewrites their URLs
# natively, so the native bundle never carries them.
[ -d clinix ] && mkdir -p "$WWW/clinix" && cp -R clinix/. "$WWW/clinix/"

# SURGX content (protocols / procedures / steps / cases / evidence / media manifest). Same rule and
# the same failure mode as clinix above: root *.js and *.css are globbed, DATA DIRECTORIES ARE NOT.
# Without this line the module loads, the tile appears, and every section renders empty on the device.
# The surgical DECISION logic is not here - it lives in ws-surgery.js, which the root *.js glob
# already copies, so there is nothing extra to do for it.
[ -d surgx ] && mkdir -p "$WWW/surgx" && cp -R surgx/. "$WWW/surgx/"

# NMC Logbook curriculum packs + assessment templates. Same rule and the same failure mode as clinix
# and surgx above: the root *.js glob copies the module code, DATA DIRECTORIES ARE NOT COPIED. Without
# this line pglog loads, the tile appears, and every requirement list is empty on the device — which
# for THIS module means a logbook that cannot tell a resident what the NMC requires. These are small
# plain-JSON files (well under a MB in total), so they are bundled rather than fetched from Pages.
[ -d pglog ] && mkdir -p "$WWW/pglog" && cp -R pglog/. "$WWW/pglog/"
# NOTE: pglog-sources/ (the extracted text of the NMC PDFs, ~900 KB) is deliberately NOT copied. It is
# the evidence the provenance test checks the packs against, not a runtime asset, and it lives outside
# pglog/ precisely so this line cannot pick it up.

# Native-only license lock (Phase 2b): when KB_ENCRYPT=1 (+ env KB_KEY = the server APP_KB_KEY secret,
# base64 32B), AES-GCM-encrypt the KB blobs the loader gates, ship ONLY the .enc (drop the plaintext KB),
# and flip window.SMD_KB_ENC=1 so kb-loader.js takes the licensed path. Default (unset) = plaintext, unchanged.
if [ "${KB_ENCRYPT:-}" = "1" ]; then
  [ -n "${KB_KEY:-}" ] || { echo "  KB_ENCRYPT=1 requires env KB_KEY (base64 32-byte key = the APP_KB_KEY Pages secret)"; exit 1; }
  KBENC="kb/dist/kb.core.js kb/dist/kb.clinical.js kb/dist/kb.enrichment.js kb/dist/kb.enrichment.2.js kb/dist/kb.expanded.js"
  node "$ROOT/scripts/encrypt-kb.mjs" --out "$WWW" $KBENC >/dev/null || { echo "  KB encrypt FAILED"; exit 1; }
  for f in $KBENC; do rm -f "$WWW/$f"; done   # ship ONLY the .enc; the plaintext KB never reaches the bundle
  [ -f "$WWW/index.html" ] && sed -i.bak 's/window\.SMD_KB_ENC=0;/window.SMD_KB_ENC=1;/' "$WWW/index.html" && rm -f "$WWW/index.html.bak"
  echo "  KB ENCRYPTED (SMD_KB_ENC=1, .enc only; plaintext KB dropped from www/)"
fi

# Connect EMR owner console (bundled so the owner-only in-app "Connect EMR" button in home.js opens it in-app).
[ -f admin/connect-emr.html ] && cp admin/connect-emr.html "$WWW/connect-emr.html"

# ── 6. Stamp a UNIQUE build number into the version display ───────────────────
# Every build:www stamps the current git commit-count as the build number into the
# About "· build N" line, so each build is uniquely identifiable (like the gold-NNN
# cache tags). The source keeps a placeholder; the shipped www/ always gets the real
# number, so the About page reflects exactly which build is running.
BN="$(git -C "$ROOT" rev-list --count HEAD 2>/dev/null || echo 0)"
if [ "$BN" != "0" ] && [ -f "$WWW/index.html" ]; then
  sed -i.bak "s/· build [0-9][0-9]*/· build $BN/g" "$WWW/index.html" && rm -f "$WWW/index.html.bak"
  echo "  build: #$BN"
fi

# ── summary ───────────────────────────────────────────────────────────────────
echo "www/ assembled at: $WWW"
echo "  size:  $(du -sh "$WWW" | cut -f1)"
echo "  files: $(find "$WWW" -type f | wc -l | tr -d ' ')"
echo "  html:  $(cd "$WWW" && ls *.html 2>/dev/null | tr '\n' ' ')"
