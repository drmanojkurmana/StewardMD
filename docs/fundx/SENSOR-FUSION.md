# FundX Acquisition — Sensor Fusion

Layered sensor-fusion on top of the monocular acquisition engine. Full design + both phases:
`docs/superpowers/specs/2026-07-18-fundx-sensor-fusion-design.md`.

## Phase 1 — cross-platform IMU fusion (SHIPPED, this module)

`fundx-sensors.js` (`window.SMD_FUNDX_SENSORS`) adds real device-motion signals (W3C
**DeviceMotion**: accelerometer + gyroscope) and fuses them with the engine's monocular signals
into a per-signal `{value, confidence}` and a **unified acquisition confidence**. Purely
additive and flag-gated — with the flag off, or no motion sensor / permission, the engine is
byte-identical to before (verified: all existing FundX suites pass unchanged).

### Contract
- **Capability detection:** `capabilities(window)` → `{deviceMotion, deviceOrientation,
  motionPermission, nativeDepth, nativePose}`.
- **Adapters** emit `{value, confidence, source}`. Phase 1 ships `makeImuAdapter()` (DeviceMotion
  → a `motion` signal, 0 = still, from `max(linear-accel, rotation-rate)`, EMA-smoothed;
  confidence ramps with sample count). Phase 2 native depth/pose plug in as more adapters through
  the **same contract** — no engine/UI change.
- **Fusion:** `fuse(sources)` → confidence-weighted mean; confidence `1 − Π(1 − confᵢ)`
  (independent evidence); **source disagreement lowers confidence** so one rogue sensor can't
  dominate.
- **Manager:** `makeManager()` wires adapters; `read(monoPartial)` returns the fields the sensors
  improve (`motion`, `motionConfidence`, `motionSources`, `acqConfidence`) ready to
  `Object.assign` into the frame partial. The monocular MediaPipe motion is itself a fusion
  source, so **with no sensor data the motion value is unchanged** (fallback-identical).

### Integration
- `fundx-detect.js` `makeHub` creates the manager when `SMD_FUNDX_SENSORS.flagOn()` (or an
  injected manager), fuses it in `build()`, starts/stops it with the camera, resets per session.
- `fundx-vision.js` `makeFrameAnalysis` passes through `motionConfidence` (default 1) and
  `acqConfidence` (default null). **Gate logic is unchanged** — the motion gate uses the fused
  `motion`, so guidance ("hold steady") and capture timing improve automatically with no
  rebaseline.

### Enable
- Flag `smd_fundx_sensors` — `?fundxsensors=1`, or **Settings → Motion sensor fusion**.
- iOS 13+ needs DeviceMotion permission; requested from the **Start guided capture** tap
  (`SMD_FUNDX_SENSORS.requestMotionPermission()`). Requires `NSMotionUsageDescription` (present).
  Denial → automatic monocular fallback.

### Tuning
`SMD_FUNDX_SENSORS.CFG` (`accelStill/accelMax/gyroStill/gyroMax/emaAlpha/warmSamples/disagreeMax/
mpEyeConf/mpNoEyeConf`) needs on-device calibration, same philosophy as `SMD_FUNDX_VISION.CFG`.

### Tests
`test/fundx-sensors.test.mjs` (24 checks): capability detection, IMU adapter under synthetic
`devicemotion` events (still→low-motion, shake→high-motion, confidence ramp, detach), fusion math
(passthrough / agree→higher / disagree→lower / invalid-skip), manager fallback-identity + fusion,
and the flag. All existing FundX suites remain green.

## Phase 2 — native depth/pose (planned, flag `smd_fundx_depth`)

Local Capacitor plugin `@stewardmd/capacitor-fundx-depth`: iOS ARKit `sceneDepth`/LiDAR + AVDepth,
Android ARCore Depth API. Resolves the camera-ownership conflict (`getUserMedia` vs native
capture) by having the native AR session own the camera and stream `{frame, depthMap, cameraPose}`
to the JS engine; the WebView becomes a transparent HUD. Populates the engine's existing
`distanceMm` field with metric distance. Device-gated, **never required**, fallback to Phase 1 /
monocular. Cannot be verified without LiDAR/ARCore-Depth hardware — ships flag-OFF until on-device
validation. See the design spec for the full API list and limitations.
