# FundX Acquisition — Hybrid Sensor-Fusion Engine

Layered, additive sensor fusion on top of the existing monocular acquisition engine. Every layer
is **flag-gated and reversible**, and the monocular MediaPipe + computer-vision pipeline is the
**guaranteed fallback** on any device. Full design: `docs/superpowers/specs/2026-07-18-fundx-
sensor-fusion-design.md`.

## Architecture

```
 monocular base (unchanged, always the fallback)
   fundx-detect.js  Heuristic (focus/exposure/glare/red-reflex/fundus/vessels), makeMediaPipe
                    (eye/pupil/iris), makePose (deviceorientation roll)
   fundx-vision.js  gates + diagnosticScore + state machine
        │
        ▼
 fusion layer  fundx-sensors.js = SMD_FUNDX_SENSORS
   • capability detection (DeviceMotion / DeviceOrientation / native depth)
   • adapters, each emitting {value, confidence, source}:
       ImuAdapter    (W3C DeviceMotion — accel+gyro)            [Phase 1, all devices]
       DepthAdapter  (native FundxDepth plugin)                 [Phase 2, device-gated]
   • fuse(): confidence-weighted mean, confidence = 1 − Π(1−confᵢ), disagreement penalty
   • manager.read(monoPartial) → fused motion/distance/pose + unified acqConfidence + contributions
        │
        ▼
 native depth (Phase 2, approach A — the native session OWNS the camera and streams frames to JS)
   Android  FundxDepthPlugin.java   ARCore + Depth API (offscreen EGL session)
   iOS      FundxDepthPlugin.swift  ARKit + LiDAR SceneDepth + CoreMotion
   each streams "fundxDepthFrame" = { cameraImage(JPEG), distanceMeters, distanceConfidence,
   roll, pitch, tracking, ts }; makeCamera.startNative() runs the SAME heuristics/MediaPipe on
   the native frames + fuses metric depth/pose, with graceful fallback to getUserMedia.
```

## Phases

- **Phase 1 — IMU fusion (cross-platform, no native code):** W3C DeviceMotion (accel+gyro) fused
  with the monocular motion into a steadier motion/stability signal. Fallback-identical when off.
- **Phase 2 — native depth (device-gated):** ARCore (Android) / ARKit+LiDAR (iOS) supply **metric
  distance + camera pose**, and (approach A) the native session owns the camera and streams frames
  to JS so the existing heuristics keep running. Metric distance overrides the monocular near/ok/far
  state; pose refines roll; everything folds into one `acqConfidence`.

## Confidence fusion

Per signal (distance / motion / pose): confidence-weighted mean of all available sources;
combined confidence `1 − Π(1 − confᵢ)` (independent evidence); a **disagreement penalty** lowers
confidence when sources diverge so one bad sensor can't dominate. The unified `acqConfidence` is
the mean of the available per-signal confidences.

## Runtime capability detection & fallback

No manual configuration. On capture start the depth adapter calls `FundxDepth.capabilities()`; the
best available stack is used and degrades automatically:
**native depth + pose + IMU → IMU + orientation → monocular MediaPipe + CV.**
Depth is **never required** — absent LiDAR/ARCore-Depth/DeviceMotion changes only *how well*
distance/stability are estimated, never *whether* a capture can happen. If `startNative()` fails
(no plugin, camera busy, unsupported), the capture flow falls back to `getUserMedia`.

## Feature flags (all default OFF except auto-flash)

| Flag (localStorage / `?query`) | Default | Effect |
|---|---|---|
| `smd_fundx` / `?fundx=1` | OFF | master — enables FundX for the user |
| `smd_fundx_sensors` / `?fundxsensors=1` | OFF | Phase 1 IMU fusion |
| `smd_fundx_depth` / `?fundxdepth=1` | OFF | Phase 2 native depth fusion |
| `smd_fundx_flash` | **ON** | auto-flash torch during capture (Android; iOS WebView has no torch) |
| `smd_fundx_dev` / `?fundxdev=1` | OFF | Developer mode — surfaces the Developer · Sensor fusion page + overlay |
| `smd_fundx_dev_{arkit,lidar,scenedepth,arcore,arcoredepth}` | ON (auto) | per-sensor enable (still gated by real availability) |
| `smd_fundx_dev_forcemono` | OFF | force the monocular pipeline (ignore all native depth) |

## Developer Settings (testing/debugging only, hidden behind `smd_fundx_dev`)
Per-sensor toggles + force-mono, plus a **live status** panel: async runtime capabilities (ARKit /
LiDAR / SceneDepth / ARCore / ARCore Depth / camera pose / CoreMotion), and the live acquisition
state (active pipeline, fusion mode, confidence %, FPS, last depth mm, per-signal contributions).

## Supported devices & fallback behaviour

| Device class | Depth path | Behaviour |
|---|---|---|
| iPhone/iPad Pro (LiDAR) | ARKit `.sceneDepth` | metric depth + pose fused |
| iPhone non-Pro | — (no LiDAR) | monocular + IMU (SceneDepth reports false) |
| Android w/ ARCore Depth | `acquireDepthImage16Bits` (depth-from-motion / ToF) | metric depth + pose fused |
| Android w/o ARCore Depth | — | monocular + IMU |
| Any device, depth flag OFF | — | monocular MediaPipe + CV (unchanged) |

## Verified testing results

- **Android (Pixel 9, on-device):** `capabilities()` → `{arcore:true, arcoreInstalled:true,
  arcoreDepth:true, depth:true, pose:true}`. ARCore session resumes (`started:true`), streams ~14
  fps `fundxDepthFrame`; camera-handoff streams valid JPEG frames (~7 fps) and the **existing
  heuristics compute on native frames** (verified: FrameAnalysis focus/exposure/fundus/vessel).
  Real metric depth/pose require device motion (non-ToF depth-from-motion; a stationary phone reads
  `tracking:PAUSED`). Developer Settings show the real caps.
- **iOS (iPhone 17 Pro, on-device):** verified — ARKit + LiDAR + SceneDepth confirmed; metric depth
  streams from the LiDAR sensor; Developer Settings show ARKit/LiDAR/SceneDepth = yes.
  `FundxDepthPlugin.swift` (local SPM plugin: ARKit `.sceneDepth`/`.smoothedSceneDepth` + CoreMotion
  + camera pose).
- **Automated:** 38 sensor-fusion unit tests (incl. fallback-identity + depth/pose fusion) + all
  FundX suites + headless fake-camera integration green. `build:www` assembles; Android/iOS builds
  clean.

## Performance impact

- Monocular (flag OFF): **zero** change.
- Phase 1 IMU: negligible (a lightweight DeviceMotion listener + a few floats/frame).
- Phase 2 depth: the native AR session + ~7 fps JPEG camera-image transfer over the bridge is the
  main cost (base64 image streaming); tune the throttle/quality in `FundxDepthPlugin`. A shared-
  texture path would remove the transfer cost (future optimisation).

## Known limitations

- **iOS** metric depth needs LiDAR (Pro devices); non-LiDAR iPhones stay monocular + IMU.
- **Android** depth without a ToF sensor is depth-from-motion → needs device motion + a textured
  scene to converge; stationary = no metric distance.
- **Camera-handoff perf** — base64 JPEG streaming is functional but not free; the shared-GL-texture
  optimisation is deferred.
- On-device **CFG calibration** of the metric working-distance band (`workingNearM/workingFarM`) is
  still required before clinical use, per the validation program.
- Native code (Swift + Kotlin/Java) is per-platform maintenance vs the buildless JS engine.
