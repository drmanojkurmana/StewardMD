#!/usr/bin/env bash
# StewardMD — Cloudflare Pages build command (set in the Pages dashboard as:
#   bash scripts/pages-build.sh
# with build output directory left blank (repo root) — same as today).
#
# Pages deploys the repo root as the site and caps a deployment at 20,000
# files / 25 MiB per file (developers.cloudflare.com/pages/platform/limits).
# Pages Functions under functions/ are compiled separately and do not count
# toward the file cap. The dashboard used to run only
# `rm -rf test docs vault android ios`, which crossed the cap on 2026-10-13
# (commit a9324fc01 added 545 prep/lessons/v1 files: 19,734 -> 20,284 static
# files) and every production build has failed since.
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
#   prep/overlays, prep/bank, prep/art (logos fetched by prep.js), data/,
#   assets/, vendor/, tokos/, ophthalmos/, narke/, clinix/, wardsynq/,
#   medcore/, root *.js/*.css/*.html, _headers, _redirects.
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf \
  test docs vault android ios \
  worker prep-arena-worker voice-worker \
  kb/reference kb/validation kb/diseases kb/tools \
  prep/fill prep/screen prep/build \
  bench backend tools scripts \
  local-plugins Packages atlas-pipeline scrollcraft \
  store-assets tokos-models voice-service voice-benchmark \
  prompts infra qa-report archive .fleet-reports .github .planning

echo "pages-build: static files (excl functions/) = $(find . -type f -not -path './functions/*' -not -path './.git/*' | wc -l | tr -d ' ')"
