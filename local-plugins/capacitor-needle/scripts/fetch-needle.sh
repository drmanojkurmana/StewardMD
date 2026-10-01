#!/usr/bin/env bash
# Fetch the prebuilt Needle 3 engine and base weights, pinned by sha256 (values measured 2026-09-30
# on the files audited in vault/plans/Needle-Audit.md). A changed upstream file FAILS here instead
# of silently shipping a different engine. Run from local-plugins/capacitor-needle/.
set -euo pipefail
HF="https://huggingface.co/Cactus-Compute/needle3/resolve/main"
cd "$(dirname "$0")/.."
fetch() {   # url  dest  sha256
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
