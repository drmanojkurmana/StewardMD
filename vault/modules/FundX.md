---
tags: [module, ai, imaging]
status: CODE-GATED BETA since 2026-09-25 (owner decision): hidden by default, unlocked per device with a StewardMD access code (SMD_XACCESS); on-device + clinical validation still outstanding
flag: smd_fundx (def:false; set to 1 on unlock; debug builds auto-enable). Home tile, Settings and the ICU "launch fundx" entry all pass SMD_XACCESS.gate("fundx")
---
# FundX

AI-guided smartphone **fundus / retinal imaging** (Vision + Clinical + Steward engines). Web + Capacitor
(NOT Flutter). Observable-cue acquisition (no lens detection). PR #456 merged + deployed; flag OFF until
on-device + clinical validation.

## Key files
- `fundx-*.js` — detect (`fundx-detect.js`, MediaPipe face landmarker), sensors, HUD, flags
- native Spatial AR: `feat/fundx-spatial-ar` (ARKit / ARCore world-anchored guide)
- `functions/api/fundx` — Cloudflare backend (real Vertex vision + clinical)

## Assets (on-demand, gold1048)
MediaPipe WASM + `face_landmarker.task` (~22 MB) are **stripped from the native bundle** and fetched
from `stewardmd.in` on first use (loader tries `[LOCAL, SELF(stewardmd.in), CDN(jsdelivr)]`). FundX is
OFF by default → most installs never fetch them. See [[Decisions]] · `scripts/strip-native-ondemand.sh`.

## Gotchas
- **JS edits don't reach the native WKWebView** (SW/cache) → rebuild-visible features must be NATIVE-driven (DEBUG-force gpuPreview). Read device state via `devicectl --console FUNDX_DBG`, not the stale-JS HUD.
- Android bundles ML Kit face-detection (native, ~8 MB/device) — could move to Google downloadable, see [[Roadmap]].
Deps: [[AI Control Center]] · [[Infra]] (Vertex).
