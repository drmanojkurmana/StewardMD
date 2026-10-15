#!/usr/bin/env bash
# StewardMD — Cloudflare Pages build command (set in the Pages dashboard as:
#   bash scripts/pages-build.sh
# with build output directory left blank (repo root) — same as today).
#
# Pages deploys the repo root as the site and caps a deployment at 20,000
# files / 25 MiB per file (developers.cloudflare.com/pages/platform/limits).
# Pages Functions under functions/ are compiled separately and do not count
# toward the file cap. The dashboard used to run only
# `rm -rf test docs vault android ios`, which crossed the cap on 2026-10-13:
# the last green commit (9984b49a3, via 38684c31f/f346bec2e) sat at 19,737
# static files, and 7c1c07f5a added 549 prep/ files (mostly
# prep/lessons/v1/*.json) taking it to 20,289. Every production build has
# failed since (22,851 static files by d93c99577).
#
# This script is the single source of truth for what Pages must NOT ship.
# Everything removed here stays in git (tools, tests and the native bundle
# are unaffected — scripts/build-www.sh never reads this file); the rm runs
# only in the Pages build copy. test/pages-output.test.mjs parses the list
# below and fails CI before the cap is crossed again.
#
# KEPT on purpose (runtime-fetched from Pages, do not add here):
#   functions/ + connect-agent/ (functions/api/connect imports
#   connect-agent/manifest/*.mjs), atlas/ (.webp slices + 3d .bin.gz are
#   served from Pages), kb/dist + runtime kb/ dirs, prep/lessons,
#   prep/overlays, prep/bank, prep/art (logos fetched by prep.js), data/
#   (functions/ also imports data/interaction-rules.json at bundle time),
#   assets/, vendor/, tokos/ + tokos-models/ (tokos-loader.js loads
#   tokos-models/<id>.js on first open), narke/ + narke-models/,
#   ophthalmos/, clinix/, wardsynq/ (functions/ imports wardsynq/*.js),
#   medcore/, scripts/ (this script deletes its own directory otherwise;
#   scripts/ already ships today, so keeping it changes nothing),
#   root *.js/*.css/*.html (several are functions/ bundle inputs),
#   _headers, _redirects.
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf \
  test docs vault android ios \
  worker prep-arena-worker voice-worker \
  kb/reference kb/validation kb/diseases kb/tools \
  prep/fill prep/screen prep/build \
  bench backend tools \
  local-plugins Packages atlas-pipeline scrollcraft \
  store-assets voice-service voice-benchmark \
  prompts infra qa-report archive .fleet-reports .github .planning

# Pages rejects an output directory with broken symlinks ("build output directory contains links to files that
# can't be accessed", build log 2026-10-14 20:16Z). npm clean-install links file: dependencies such as
# node_modules/capacitor-whisper -> ../local-plugins/..., and local-plugins is removed above, so those links dangle.
# Drop every broken link in the build copy (node_modules stays: functions bundling needs the real packages).
# Also drop links that resolve outside the repo: Pages cannot read those either.
root=$(pwd -P)
find . -path ./.git -prune -o -type l -print0 | while IFS= read -r -d '' l; do
  # [ -e ] first: GNU realpath returns a path for a dangling link, so it alone would keep it.
  if [ -e "$l" ]; then t=$(realpath "$l" 2>/dev/null || true); else t=; fi
  case "$t" in "$root"/*) ;; *) rm -f "$l"; echo "pages-build: removed link $l" ;; esac
done

echo "pages-build: static files (excl functions/) = $(find . -type f -not -path './functions/*' -not -path './.git/*' | wc -l | tr -d ' ')"
