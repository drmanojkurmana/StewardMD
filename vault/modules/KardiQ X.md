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
- **One button, two click handlers.** The router owns a DELEGATED listener on `#kardioxRoot`
  (`init()`), while individual screens set `host.onclick` on `#kxScroll`, a DESCENDANT. A screen
  handler that does not stop propagation therefore runs AND then the router's `onClick` runs for the
  same `data-act`. That is how the lesson bookmark ended up toggling the store twice and netting
  zero. Rule: a `data-act` emitted by exactly one screen belongs to that screen — do not also add a
  case for it to the router's switch.
- Tests that swap providers must call `SMD_KARDIOX_PROVIDERS.use()` **after** `KARDIOX.open()`:
  `open()` fires `checkBackend()`, whose health probe sets `_active = null` when it settles, silently
  discarding an assembly injected beforehand. `?kardioxbackend=0` makes it early-return instead.

## Tests
- `node test/kardiox-providers.test.mjs` / `test/kardiox-screens.test.mjs` — unit (in the CI glob).
- `node test/run-kardiox-progress-ui.mjs` — **real headless Chrome**, the Learn-progress regression
  net: ring denominator, store overlay onto rows, Atlas chip filtering, and a bookmark surviving a
  full reload. Not in CI (no browser job); run it by hand when touching the library/lesson screens.

Deps: [[AI Control Center]] (ecg cap 10/day) · [[Infra]] R2.
