#!/usr/bin/env bash
# Fetch the prebuilt Needle 3 engine and base weights, pinned by sha256 (values measured 2026-09-30
# on the files audited in vault/plans/Needle-Audit.md). A changed upstream file FAILS here instead
# of silently shipping a different engine. Run from local-plugins/capacitor-needle/.
set -euo pipefail
# Pinned to the repo revision that carries exactly these files: `main` moved on 2026-10-02 (f84005f8,
# "Replace binaries from production build") and no longer serves them. A new revision is a re-audit.
# f84005f8 (engine 3.1.0) was re-audited 2026-10-04 and NOT adopted: needle_complete's ABI changed, +28%
# size, same decisions, thread fallback and hang (vault/plans/Edge-Runbook.md 5d).
HF="https://huggingface.co/Cactus-Compute/needle3/resolve/27c0a9a5b3ca835e0b7dbeaccf555df03dac493d"
cd "$(dirname "$0")/.."
fetch() {   # url  dest  sha256
  # A file already here with the pinned hash is kept: upstream may have moved on (it did on 2026-10-02),
  # and the pin is what we audited, so a re-run must not need the network or the current upstream file.
  if [ -f "$2" ] && echo "$3  $2" | sha256sum -c - >/dev/null 2>&1; then echo "ok  $2 (pinned copy)"; return 0; fi
  mkdir -p "$(dirname "$2")"
  curl -fL --retry 3 -o "$2.part" "$1"
  echo "$3  $2.part" | sha256sum -c - >/dev/null || { echo "SHA-256 MISMATCH for $1 (upstream changed: re-audit before updating the pin)"; rm -f "$2.part"; exit 1; }
  mv "$2.part" "$2"; echo "ok  $2"
}
fetch "$HF/android-arm64/libneedle.a" android/libs/arm64-v8a/libneedle.a b8e73952054686f68e4319dcf69ad72a3de57faab73b73d9a67898f2c9d66110
fetch "$HF/ios-arm64/libneedle.a"     build/ios-arm64/libneedle.a       9cbacdf197c997b126962bedc8852b970ee73c7367b5f605123d318f04423cc6
# The simulator slice is optional (device testing is the rule here); its hash was not audited.
if [ "${WITH_SIM:-0}" = "1" ]; then curl -fL -o build/ios-sim-arm64/libneedle.a --create-dirs "$HF/ios-sim-arm64/libneedle.a"; fi
fetch "$HF/wasm/needle.h"             include/needle.h                  3aa713942528d944598458cecb4a262f2cc49349bec63355f91df0b159964e55
fetch "$HF/needle3.cact"               build/weights/needle3.cact         c9d915eca282ed42d1a09b143b592adb4cc6744ffe2d294adf5cfc5548170c38
echo
echo "Weights are NOT bundled into the app. build/weights/needle3.cact is the BASE model (35.3 MB); the"
echo "router uses the TUNED .cact the Cactus platform returns. Copy one to the app's files dir (README)"
echo "and pass its path to load()."
