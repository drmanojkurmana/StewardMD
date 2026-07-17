# MediaPipe Tasks Vision — vendored assets for FundX AI

FundX's `fundx-detect.js` uses MediaPipe FaceLandmarker (refined landmarks incl. iris)
for **real** eye-presence, pupil-centering, phone→eye distance, and motion detection —
the signals that drive beginner 20D-lens alignment coaching.

## Status

By default `fundx-detect.js` loads MediaPipe from the jsDelivr CDN
(`@mediapipe/tasks-vision@0.10.14`) the first time the camera opens. If that load
fails (offline, blocked), the module sets `available() === false` and guidance
degrades **gracefully** to heuristic-only (focus/exposure/reflection/red-reflex still
work; eye/pupil landmark arrows are simply not shown). No crash, no blocking.

## To vendor locally (recommended for offline + no CDN dependency)

Drop these files into this folder (each is well under the 25 MiB Cloudflare Pages
per-file limit):

```
assets/vendor/mediapipe/
  vision_bundle.mjs            # from @mediapipe/tasks-vision
  wasm/                        # the wasm/ directory from the same package
    vision_wasm_internal.js
    vision_wasm_internal.wasm
    ...
  face_landmarker.task         # the FaceLandmarker model (~3–4 MB)
```

Then point the loader at this path (e.g. in `fundx.js` before opening the camera, or
inline early):

```js
window.SMD_FUNDX_DETECT.mediapipeAssetBase = "/assets/vendor/mediapipe";
```

`build-www.sh` copies `assets/` into `www/` automatically, so vendored files ship
with the app and the OTA bundle.

## Swapping the detector entirely

`fundx-detect.js` exposes `makeMediaPipe()` behind the DetectorHub. Any equivalent
detector (a different landmark model, a native plugin bridge, etc.) can replace it by
constructing the hub with `makeHub({ mediapipe: yourAdapter })`, as long as its
`analyze()` returns the same `{ eyePresent, eyeConf, pupilCentered, pupilOffset,
pupilDir, distanceState, motion }` partial. The engine, UI, and data contracts are
unaffected.
