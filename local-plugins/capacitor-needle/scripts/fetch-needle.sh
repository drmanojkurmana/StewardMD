#!/usr/bin/env bash
# Fetch the prebuilt Cactus engine (4.1.0, which runs Needle 3) and the Needle 3 base weights, pinned by
# sha256. A changed upstream file FAILS here instead of silently shipping a different engine.
# Run from anywhere; paths are relative to local-plugins/capacitor-needle/.
#
# Engine history: until 2026-11-13 this fetched the standalone Needle engine (libneedle.a + needle.h)
# from Cactus-Compute/needle3 revision 27c0a9a5 (audited 2026-09-30, vault/plans/Needle-Audit.md).
# Cactus then moved every engine binary out of the needle3 repo into Cactus-Compute/cactus, one engine
# for Needle, Whistle and Mirage. Release 4.1.0 (repo revision 4e822c90, source commit 89a1c500) was
# re-audited 2026-11-13 (vault/plans/Edge-Runbook.md 5f) and adopted. The weights are unchanged:
# needle3.cact at the new needle3 revision has the same sha256 as the audited file.
set -euo pipefail
ENGINE="https://huggingface.co/Cactus-Compute/cactus/resolve/4e822c9036be2eb0e47ef556df32a818bb1572ef/releases/4.1.0"
WEIGHTS="https://huggingface.co/Cactus-Compute/needle3/resolve/c95d25b4efa1e9601e785d92438e4ade0dbddbf8"
cd "$(dirname "$0")/.."
fetch() {   # url  dest  sha256
  # A file already here with the pinned hash is kept: upstream may move on, and the pin is what we
  # audited, so a re-run must not need the network or the current upstream file.
  if [ -f "$2" ] && echo "$3  $2" | sha256sum -c - >/dev/null 2>&1; then echo "ok  $2 (pinned copy)"; return 0; fi
  mkdir -p "$(dirname "$2")"
  curl -fL --retry 3 -o "$2.part" "$1"
  echo "$3  $2.part" | sha256sum -c - >/dev/null || { echo "SHA-256 MISMATCH for $1 (upstream changed: re-audit before updating the pin)"; rm -f "$2.part"; exit 1; }
  mv "$2.part" "$2"; echo "ok  $2"
}
# Old engine files from before the move would be picked up by nothing, but remove them so a stale
# libneedle.a never sits next to the new archive.
rm -f android/libs/arm64-v8a/libneedle.a build/ios-arm64/libneedle.a build/ios-sim-arm64/libneedle.a include/needle.h
fetch "$ENGINE/android-arm64/libcactus.a" android/libs/arm64-v8a/libcactus.a ba543bb4305f7648120b97f7be57e230fc5432a6eb7bc416817d1f2f78a1f5fb
fetch "$ENGINE/ios-arm64/libcactus.a"     build/ios-arm64/libcactus.a       c811cb28906088491b1af2d1ec8593dc2c00a225603c97f190ac31137ec5e47a
# The simulator slice is optional (device testing is the rule here); its hash is the release manifest's.
if [ "${WITH_SIM:-0}" = "1" ]; then
  fetch "$ENGINE/ios-sim-arm64/libcactus.a" build/ios-sim-arm64/libcactus.a 33877e12d6ea1a9eb909eb76cef0c3c7103abbc6a5e4caaace024c70e901980b
fi
# One header for every platform (identical bytes in each release folder).
fetch "$ENGINE/android-arm64/cactus.h"    include/cactus.h                  9be7eb25b1d89180495d04a0d2c27053f282dac85add50cacc48d73302819d9d
fetch "$ENGINE/LICENSE"                   build/LICENSE-cactus              cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30
fetch "$WEIGHTS/needle3.cact"             build/weights/needle3.cact        c9d915eca282ed42d1a09b143b592adb4cc6744ffe2d294adf5cfc5548170c38
echo
echo "Weights are NOT bundled into the app. build/weights/needle3.cact is the BASE model (35.3 MB); the"
echo "router uses the TUNED .cact the Cactus platform returns. Copy one to the app's files dir (README)"
echo "and pass its path to load()."
