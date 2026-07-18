# FundX Acquisition Engine — Sensor-Fusion Upgrade (Design Spec)

**Date:** 2026-07-18
**Status:** Design — awaiting user review before implementation
**Scope (approved):** BOTH phases — Phase 1 cross-platform IMU sensor-fusion **and** Phase 2
native ARKit/ARCore/LiDAR depth.

## 1. Goal

Upgrade FundX acquisition to fuse **every relevant platform sensor** on top of the existing
monocular pipeline, producing a **unified confidence** for each acquisition signal
(distance / alignment / stability / pose) instead of relying on any single source — improving
accuracy, precision, working-distance, alignment, stability, and reducing failed captures —
while **preserving 100% of the current engine as the guaranteed fallback** and never *requiring*
any advanced sensor.

Additive, feature-flagged, reversible ([[stewardmd-reversible-changes]]). No existing
functionality is removed. This upgrade sits *upstream* of the advisory clinical output and does
not change the locked advisory-only intended use.

## 2. Current architecture (audit — the fallback we preserve)

- **Camera:** WebRTC `getUserMedia` rear camera → `<video>` → offscreen-canvas frame grab
  (`fundx-detect.js` `makeCamera`, `:278`). **The WebView owns the rear camera.**
- **Signals (all monocular):** MediaPipe FaceLandmarker (`makeMediaPipe` `:144`): eye/pupil,
  distance = iris-width proxy (`:189-190`), motion = inter-frame pupil delta (`:191-193`);
  pixel `Heuristic` (`:29-114`): focus/exposure/glare/red-reflex/fundus-circle/vessels; phone
  roll from W3C `deviceorientation` gamma (`makePose` `:122`).
- **Merge:** `makeHub` combines partials into one `FrameAnalysis`.
- **Engine:** pure `fundx-vision.js` (`SMD_FUNDX_VISION`) consumes `FrameAnalysis` → gates
  (`:181-194`) → state machine → `diagnosticScore` + readiness. Fields already present:
  `distanceState`, `motion`, `roll`/`rollState` (`:105-109`).

## 3. The constraint that shapes the design: camera ownership

Every rear-camera depth/AR API (ARKit, ARCore, Camera2, `AVCaptureDepthDataOutput`) must **own**
the rear camera. `getUserMedia` already owns it. They cannot run simultaneously on the same
camera. Therefore capabilities divide into two classes:

- **Class A — non-camera sensors (IMU/motion/pose):** coexist with `getUserMedia`. Cross-platform,
  no native code, all devices. → **Phase 1.**
- **Class B — camera-based depth (LiDAR/ARCore Depth/dual-cam disparity):** require moving capture
  *native* and streaming frames+depth+pose to the WebView. Device-gated, native. → **Phase 2.**

**Phase 2 camera resolution:** when depth mode is active, a native capture session (ARKit /
ARCore) owns the camera, renders the preview, and streams `{previewFrame (RGBA/JPEG for the
existing heuristics + MediaPipe), depthMap (metric), cameraPose}` to the JS engine over the
Capacitor plugin bridge. The WebView becomes a transparent HUD. When depth mode is
off/unavailable, the engine uses `getUserMedia` exactly as today. The `FrameAnalysis` contract
is unchanged — only the *source* of frames/signals differs.

## 4. Target architecture

```
        ┌───────────────── fundx-sensors.js (NEW · SMD_FUNDX_SENSORS) ─────────────────┐
        │ 1. capabilityDetect() → { imu, orientation, nativeDepth, nativePose, ... }    │
        │ 2. adapters (each emits {value, source, confidence, ts}):                     │
        │    • ImuAdapter        (W3C DeviceMotion)              [P1, all devices]       │
        │    • OrientationAdapter(DeviceOrientation, existing)   [P1]                    │
        │    • DepthAdapter      (Capacitor plugin bridge)       [P2, device-gated]      │
        │    • PoseAdapter       (native ARKit/ARCore pose)      [P2, device-gated]      │
        │ 3. fuse(signal, sources[]) → { value, confidence, contributors }              │
        └──────────────────────────────────────────────────────────────────────────────┘
 getUserMedia ─┐                                   ▲ (or native frames in depth mode)
 MediaPipe ────┼─► makeHub (fundx-detect.js) ──────┘
 Heuristic ────┘        │ merges monocular partials + fused sensor signals + confidence
                        ▼
                 fundx-vision.js  (extended: accepts fused distance/motion/pose + per-signal
                 confidence; gate logic unchanged when a source is absent → today's fallback)
```

### 4.1 New module: `fundx-sensors.js` (`window.SMD_FUNDX_SENSORS`)
Buildless IIFE, StewardMD conventions. Responsibilities:
- **Capability detection** (`capabilities()`): feature-detect DeviceMotion/DeviceOrientation +
  their permission state; query the native depth plugin for `isAvailable()` (LiDAR / ARCore
  Depth / dual-cam). Returns a capability map; recomputed on start.
- **Adapters** behind a common `ISensorAdapter` seam: `start/stop/read()`; each returns
  `{ value, source, confidence, ts }`. Adding a sensor = adding an adapter, no engine change.
- **Fusion** (`fuse`): per acquisition signal, confidence-weighted combine of available sources;
  emits `{ value, confidence, contributors[] }`. Missing sources simply drop out (weight 0).
- **Unified acquisition confidence**: aggregate the per-signal confidences into one readiness
  confidence surfaced to gates, guidance, and telemetry.

### 4.2 Native plugin: `@stewardmd/capacitor-fundx-depth` (Phase 2, local plugin)
Same local-plugin pattern as `@stewardmd/capacitor-vision-ocr` (SPM-native, no external dep):
- **iOS (Swift):** ARKit `ARSession` + `frameSemantics = .sceneDepth/.smoothedSceneDepth`
  (LiDAR); fallback `AVCaptureDepthDataOutput` (dual/triple-cam `AVDepthData`) on non-LiDAR;
  `ARFrame.camera` pose; CoreMotion optional for high-rate IMU. Streams frame+depth+pose.
- **Android (Kotlin):** ARCore `Session` + `Frame.acquireDepthImage16Bits()` (Depth API,
  depth-from-motion + ToF); `Camera.getPose()`; `SensorManager` optional. Streams frame+depth+pose.
- **Bridge:** `isAvailable()`, `start(config)`, event stream `{frame, depth, pose}` throttled to
  the analysis cadence; `stop()`. Exposed as `Capacitor.Plugins.FundxDepth`.
- Registered via `cap sync` (packageClassList + SPM). Gracefully absent on web/unsupported.

### 4.3 Engine extension: `fundx-vision.js`
- `makeFrameAnalysis` accepts optional `fused` fields: `distanceMeters`, `distanceConf`,
  `motionConf`, `poseConf`, plus an overall `acqConfidence`.
- Gates use fused values **when confidence ≥ threshold**, else fall back to today's proxy logic
  (existing behavior byte-identical when no sensor present). New CFG keys (all with safe
  defaults) gate the fusion thresholds.

## 5. APIs / frameworks used (complete list)

### Phase 1 (cross-platform, no native code)
| API | Signal | Est. improvement | Limitation |
|---|---|---|---|
| W3C **DeviceMotion** (`acceleration`, `rotationRate`) | motion, stability, capture-timing | **High** — real steadiness vs noisy pupil-delta; fire at true low-motion window | iOS motion permission (`NSMotionUsageDescription`, added) + user-gesture `requestPermission`; no metric distance |
| W3C **DeviceOrientation** (existing `gamma`, extended to β/α) | 3-axis pose / leveling | Medium | proxy, not world-tracked |
| Fusion + unified confidence (pure JS) | all signals, guidance | Medium–High | complexity; must not regress fallback |

### Phase 2 (native, device-gated)
| API | Signal | Est. improvement | Limitation |
|---|---|---|---|
| iOS **ARKit `sceneDepth`/`smoothedSceneDepth`** (LiDAR) | metric working-distance, alignment | Medium (distance) | LiDAR = iPhone/iPad Pro only; owns camera |
| iOS **AVCaptureDepthDataOutput / AVDepthData** (dual-cam disparity) | metric distance on non-LiDAR iPhones | Medium (distance) | dual-camera only; owns camera; quality varies |
| iOS **ARKit `ARWorldTrackingConfiguration`** pose | camera pose / parallax-stability | Low–Medium | owns camera |
| iOS **CoreMotion** (`CMMotionManager`) | higher-rate IMU/attitude | Marginal over Phase 1 | native; only if Web DeviceMotion insufficient |
| Android **ARCore Depth API** (`acquireDepthImage16Bits`) | metric working-distance | Medium (distance) | ARCore-Depth-gated devices; owns camera |
| Android **ARCore** pose (`Camera.getPose`) | camera pose / stability | Low–Medium | ARCore devices; owns camera |
| Android **Camera2/CameraX** | exposure/focus control, ToF depth | Low–Medium | owns camera; replaces getUserMedia |
| Android **SensorManager** (`TYPE_ROTATION_VECTOR`, accel, gyro) | higher-rate pose/IMU | Marginal over Phase 1 | native |

**Excluded (with reason):** **TrueDepth** (front camera only — FundX images with the **rear**
camera → cannot measure capture-side distance); Apple **Vision** face landmarks (redundant with
MediaPipe — a swap, not an add).

## 6. Unified confidence / fusion model

For each signal `s ∈ {distance, alignment, stability, pose}`:
- Each source `i` provides `value_i` and `confidence_i ∈ [0,1]` (from sensor availability +
  intrinsic reliability + recent variance).
- Fused value = `Σ(confidence_i · value_i) / Σ(confidence_i)`; fused confidence =
  `1 − Π(1 − confidence_i)` (independent-evidence combination), capped.
- **Unified acquisition confidence** = weighted aggregate across signals; drives (a) an added
  gate term, (b) guidance priority (address the lowest-confidence signal first), (c) capture
  timing (fire only above a confidence threshold *and* the quality gate).
- Sources disagreeing beyond a tolerance **lower** the fused confidence (guards against a single
  bad sensor), rather than blindly averaging.

## 7. Capability detection + graceful fallback (requirement 5)

- On FundX open: `SMD_FUNDX_SENSORS.capabilities()` probes DeviceMotion/Orientation (+ perms) and
  `FundxDepth.isAvailable()`.
- The engine uses the **best available** stack, degrading in order: native depth+pose+IMU →
  IMU+orientation → **today's monocular engine**.
- **Never required:** absence of LiDAR/ARCore-Depth/DeviceMotion changes nothing about whether a
  capture can happen — only how well distance/stability are estimated. All gates keep a
  monocular path.

## 8. Guidance improvements (requirement 6)
- **Closer/farther:** fused iris-width + (P2) metric depth → graded continuous nudge.
- **Left/right/up/down:** pupil offset + fundus centroid, confidence-weighted.
- **Stability + capture timing:** IMU steadiness gates the burst to the true motion minimum.
- **Beginner guidance:** one unified readiness/confidence signal → fewer conflicting cues.

## 9. Feature flags (default OFF, reversible)
- `smd_fundx_sensors` — Phase 1 IMU fusion (`?fundxsensors=1` / Settings).
- `smd_fundx_depth` — Phase 2 native depth (`?fundxdepth=1` / Settings); no-op if plugin/hardware
  absent.
- Both nested under existing `smd_fundx`. Recovery tag before merge.

## 10. Testing
- **Phase 1:** headless Node unit tests for fusion math, confidence combination, capability
  detection, disagreement handling, and fallback identity (engine output unchanged when no
  sensor present); dev-overlay surfacing of per-source confidences; on-device DeviceMotion sanity.
- **Phase 2:** native plugin unit build + **device-only** validation on LiDAR (iPhone Pro) and
  ARCore-Depth Android. **Cannot be verified in this environment** — flagged OFF until on-device.
- Regression: all 7 existing FundX suites + `run-fundx` integration stay green.

## 11. Limitations / risks
- **Camera-ownership rework (P2):** native capture-to-WebView streaming is the heaviest, riskiest
  part; latency + battery must be measured on device.
- **Depth helps one of six signals (distance)** and only on some devices; it does not measure the
  real bottleneck — image quality through the handheld condensing lens.
- **Untestable here (P2):** no LiDAR/ARCore-Depth hardware; native builds need device runs.
- **iOS DeviceMotion permission** needs a user gesture (iOS 13+ `requestPermission`).
- **Complexity:** fusion + native bridge add surface area; the pure-JS fallback must remain the
  default and never regress.
- **Maintenance:** per-platform native code (Swift + Kotlin) is ongoing cost vs the buildless
  single engine.

## 12. Milestones
1. **P1a** `fundx-sensors.js` skeleton + capability detection + DeviceMotion IMU adapter + tests.
2. **P1b** fusion + unified confidence + `fundx-vision.js` integration (fallback-identical) + tests.
3. **P1c** guidance improvements + dev-overlay confidences + telemetry fields + docs; flag on.
4. **P2a** `@stewardmd/capacitor-fundx-depth` plugin scaffold + `isAvailable()` + JS DepthAdapter
   (no-op fallback) + fusion wiring behind `smd_fundx_depth`.
5. **P2b** iOS Swift ARKit sceneDepth/LiDAR + AVDepth + pose; native frame/depth/pose streaming.
6. **P2c** Android Kotlin ARCore Depth + pose streaming.
7. **P2d** on-device validation, calibration, docs; keep flags OFF until validated.

## 13. Out of scope
- TrueDepth, Apple Vision landmark swap, any change to the advisory clinical output or intended
  use, and removing/altering the existing monocular engine.
