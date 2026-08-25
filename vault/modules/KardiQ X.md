---
tags: [module, ai, imaging]
status: staged
flag: smd_kardiox (default OFF)
---
# KardiQ X

ECG interpretation + Learn-ECG atlas. Web sibling of [[FundX]] (NOT SwiftUI — the README overrides the
Swift prompt). Gated OFF pending clinician sign-off + on-device visual + real backend + regulatory.

## Key files
- `kardiox-*.js` — providers (`kardiox-providers.js`), ORT engine (`kardiox-ort.js`), model manager, net client
- `kardiox-content-pack.js` + `assets/kardiox-learn/*` — the Learn atlas (1,041 lessons + quiz)
- optional ACS panel: `feat/kardiox-acs` (HEART/TIMI, flag `smd_kardiox_acs`)

## Model / inference
- **On-device**: ONNX Runtime Web (`onnxruntime-web`, WASM) inside the WebView; model weights fetched from the **PUBLIC R2 bucket `stewardmd-kardiox-models`** (India; train bucket has PHI so can't be public) — not bundled. Runtime WASM still bundled (see [[Roadmap]] on-demand).
- **Backend/mock**: RemoteAnalyzer (`/api/kardiox`) + mock analyzer. Flag-gated.

## Photo-dx pivot
image→signal digitisation loses the diagnosis → pivot to IMAGE-based model (Yale recipe: ecg-image-kit → EfficientNet). See [[Roadmap]].

## Gotchas
- On-device parity: export is bit-faithful (1e-5); the 77.5% A/B was a torchvision-version artifact.
- CORS fix + `imageSmoothingQuality=high` to match cloud.
- Learn state does NOT live in the content records. `status`/`masteryPct`/`bookmarked` are fields of
  the shipped read-only pack; writing them is lost on reload. `kxProgress` (localStorage) is the
  source of truth, and `mockLibrary` overlays it onto every row — add new state there, not in the
  pack. Mastery needs correct answers on TWO SEPARATE days, so a single quiz never masters a lesson.
- The 1,041-lesson pack is all `tier:"atlas"`; the library's tier chips must carry an Atlas chip or
  every filter hides it (only the default "All" chip and search reach it).
Deps: [[AI Control Center]] (ecg cap 10/day) · [[Infra]] R2.
