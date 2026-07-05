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
mkdir -p "$WWW" "$WWW/kb/dist" "$WWW/kb/ai" "$WWW/kb/treatments"

# ── 1. Shipping HTML (exclude demos + site-verification pages) ────────────────
for f in index.html privacy.html terms.html disclaimer.html support.html; do
  [ -f "$f" ] && cp "$f" "$WWW/"
done

# ── 2. All root app JS (buildless app), minus the Capacitor config itself ─────
for f in *.js; do
  case "$f" in
    capacitor.config.js|capacitor.config.ts) : ;;   # native config, not a web asset
    *) cp "$f" "$WWW/" ;;
  esac
done

# ── 3. Manifest + service worker ──────────────────────────────────────────────
[ -f site.webmanifest ] && cp site.webmanifest "$WWW/"
[ -f sw.js ] && cp sw.js "$WWW/"

# ── 4. Root icons / images ────────────────────────────────────────────────────
for f in *.png *.webp *.ico *.svg *.gif *.jpg *.jpeg; do
  cp "$f" "$WWW/"
done

# ── 5. Knowledge base — RUNTIME pieces only ───────────────────────────────────
# Loaded by index.html + steward-ai.browser.js; the 13 MB kb.index.json and all
# source/dev dirs (diseases, reference, validation, tools, schema, manifest…) are
# NOT fetched at runtime and are deliberately excluded.
for f in kb/dist/kb.core.js kb/dist/kb.clinical.js kb/dist/kb.enrichment.js \
         kb/dist/kb.expanded.js kb/dist/kb.rag.js; do
  [ -f "$f" ] && cp "$f" "$WWW/kb/dist/"
done
[ -d kb/ai ] && cp -R kb/ai/. "$WWW/kb/ai/"
[ -d kb/treatments ] && cp -R kb/treatments/. "$WWW/kb/treatments/"

# ── summary ───────────────────────────────────────────────────────────────────
echo "www/ assembled at: $WWW"
echo "  size:  $(du -sh "$WWW" | cut -f1)"
echo "  files: $(find "$WWW" -type f | wc -l | tr -d ' ')"
echo "  html:  $(cd "$WWW" && ls *.html 2>/dev/null | tr '\n' ' ')"
