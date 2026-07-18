# MediaPipe Tasks Vision — vendored assets for FundX AI

FundX's `fundx-detect.js` uses MediaPipe FaceLandmarker (refined landmarks incl. iris)
for **real** eye-presence, pupil-centering, phone→eye distance, and motion detection —
the signals that drive beginner 20D-lens alignment coaching.

## Status — VENDORED LOCALLY (default, offline-capable)

The runtime + model are vendored in this folder and ship in the app bundle:
`build-www.sh` copies `assets/` into `www/`, and `cap sync` copies `www/` into the
native iOS/Android bundle. `fundx-detect.js` loads MediaPipe **local-first**:

1. `/assets/vendor/mediapipe` — these vendored files (works fully **offline**, no CDN).
2. jsDelivr CDN `@mediapipe/tasks-vision@0.10.14` — fallback if the local copy is somehow missing.
3. heuristic-only (`available() === false`) if both fail — no crash, no blocking
   (focus/exposure/reflection/red-reflex still work; the eye/pupil landmark arrows are
   simply not shown).

Setting `window.SMD_FUNDX_DETECT.mediapipeAssetBase = "<root>"` forces **one** root with
no fallback (e.g. to pin the CDN or an alternate mirror).

## Vendored files (present in this folder)

```
assets/vendor/mediapipe/
  vision_bundle.mjs                    # @mediapipe/tasks-vision@0.10.14 ESM bundle (~136 KB)
  wasm/
    vision_wasm_internal.js            # ~208 KB
    vision_wasm_internal.wasm          # ~9.0 MB (SIMD)
    vision_wasm_nosimd_internal.js     # ~208 KB
    vision_wasm_nosimd_internal.wasm   # ~8.9 MB (no-SIMD fallback)
  face_landmarker.task                 # FaceLandmarker float16 model (~3.6 MB)
```

Each file is well under the 25 MiB Cloudflare Pages per-file limit (total ~22 MB).

## To refresh / re-vendor (e.g. bump the tasks-vision version)

```sh
npm pack @mediapipe/tasks-vision@<version>            # fetch the published package
tar xzf mediapipe-tasks-vision-<version>.tgz
cp package/vision_bundle.mjs assets/vendor/mediapipe/
cp package/wasm/*            assets/vendor/mediapipe/wasm/
curl -sL -o assets/vendor/mediapipe/face_landmarker.task \
  https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
```

Then bump the CDN-fallback version string in `fundx-detect.js`
(`@mediapipe/tasks-vision@…`) to match, and run `npm run build:www`.

## Swapping the detector entirely

`fundx-detect.js` exposes `makeMediaPipe()` behind the DetectorHub. Any equivalent
detector (a different landmark model, a native plugin bridge, etc.) can replace it by
constructing the hub with `makeHub({ mediapipe: yourAdapter })`, as long as its
`analyze()` returns the same `{ eyePresent, eyeConf, pupilCentered, pupilOffset,
pupilDir, distanceState, motion }` partial. The engine, UI, and data contracts are
unaffected.
