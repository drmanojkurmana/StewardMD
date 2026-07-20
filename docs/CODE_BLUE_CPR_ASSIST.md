# Code Blue: CPR Assist (Apple Watch) + Command Center (iPhone) — Delivery Report

Real-time, motion-based CPR assistant on the Apple Watch, mirrored live on a native
iPhone Command Center. Additive to the existing Code Blue module — all prior features
(ACLS timer, 2-min cycle haptic, next-drug prompt, adrenaline/shock tally, ROSC,
summary) are preserved.

Spec: `docs/superpowers/specs/2026-07-20-code-blue-cpr-assist-command-center-design.md`
Plan: `docs/superpowers/plans/2026-07-20-code-blue-cpr-assist-command-center.md`

---

## Files created

**Core (`Packages/StewardMDWatchCore` — pure, unit-tested on macOS):**
- `Sources/.../Models/CodeEvent.swift` — `CodeEventKind`, `CodeEvent` (id/elapsed/kind/label/sourceDeviceId), `RateZone`.
- `Sources/.../Models/CodeSummary.swift` — rich summary + `build(...)` aggregation + `formattedDetail()`.
- `Sources/.../Models/CodeBlueState.swift` — live watch→phone snapshot wire model.
- `Sources/.../Engines/CompressionAnalyzer.swift` — peak detection, rate, pause (no CoreMotion).
- `Sources/.../Engines/RateCoach.swift` — AHA 100–120 zone mapping + neutral guidance.
- `Sources/.../Connectivity/CompressionDetecting.swift` — detector protocol + `MockCompressionDetector`.
- `Sources/.../Connectivity/WorkoutKeepAlive.swift` — keep-alive protocol + `NoopWorkoutKeepAlive`.
- Tests: `CompressionAnalyzerTests`, `RateCoachTests`, `CodeSummaryTests`, `CompressionDetectingTests`.

**Watch app (`ios/StewardMDWatch` — isolated device I/O):**
- `System/CoreMotionCompressionDetector.swift` — the only CoreMotion file; 50 Hz device-motion → analyzer.
- `System/HealthKitWorkoutKeepAlive.swift` — `HKWorkoutSession` keep-alive, graceful CoreMotion-only fallback.

**iPhone Command Center (inside `local-plugins/capacitor-watch-bridge/.../CodeBlue/`):**
- `CodeBlueSyncService.swift` — transport protocol + WC impl + `CodeBlueLocalStore` + `mergeEvents`.
- `CodeBlueLiveModel.swift` — `@MainActor` singleton: merge-by-id, stale-guard, reachability, local persistence.
- `CommandCenterView.swift` — SwiftUI dashboard (timer/rate/pause/counters/timeline/summary/export) + `ShareSheet`.

**Tooling / docs:**
- `scripts/add-codeblue-files.rb` — registers the two watch-app files in the Xcode target.
- `docs/CODE_BLUE_CPR_ASSIST.md` (this report).

## Files modified

- `Packages/.../ViewModels/CodeBlueModel.swift` — additive: DI init, live stats, `[CodeEvent]` timeline, timestamped shock/drug/ROSC, `recordDrug`, `markSwitchCompressor`, `snapshot`, `startCode`/`endCode`.
- `Tests/.../CodeBlueModelTests.swift` — 2 new tests; existing tests unchanged.
- `ios/StewardMDWatch/CodeBlueView.swift` — CPR dashboard mode while running + `WKDeviceId`; existing controls preserved.
- `ios/StewardMDWatch/System/WatchConnectivityManager.swift` — `streamCodeBlue` (live) + `streamCodeBlueSnapshot` (guaranteed).
- `ios/StewardMDWatch/Info.plist` — HealthKit usage strings.
- `local-plugins/capacitor-watch-bridge/Package.swift` — link `StewardMDWatchCore`.
- `.../WatchBridgePlugin/WatchConnectivityRelay.swift` — route `codeBlueLive`/`codeBlueSnapshot` + app-context recovery.
- `.../WatchBridgePlugin/WatchBridgePlugin.swift` — `openCodeBlue` presentation, `codeBlueExport` event, live-model bootstrap, clear-on-sign-out.
- `index.html` — premium Code Blue home card.
- `native-watch.js` — native-only card gating, launch, export routing.
- `icu-collab.js` — `currentOpenPatient()` getter + export.
- `docs/APPLE_WATCH.md` — one-time HealthKit capability steps.

## Architecture decisions

- **Motion isolation.** All signal processing is a pure `CompressionAnalyzer` in Core; device I/O sits behind `CompressionDetecting`/`WorkoutKeepAlive` protocols with the CoreMotion/HealthKit impls confined to two watch-app files. The UI/VM never import CoreMotion, and the algorithm is fully unit-tested with synthetic waveforms.
- **Reuse over rebuild.** Shock/drug/ROSC/2-min cycle/summary already existed in `CodeBlueModel` and were extended additively — the new work is compression detection, rate coach, pause, per-event timeline, and sync.
- **Single WCSession delegate.** The phone already had one delegate (`WatchConnectivityRelay`); Code Blue data is routed through it via `NotificationCenter`, exactly like the existing task/ack relays.
- **Three-tier sync.** `sendMessage` (live), `transferUserInfo` (guaranteed snapshots for auto-recovery, merged by event id), `updateApplicationContext` (survives phone relaunch).
- **Shared Codable contract** in `StewardMDWatchCore` (already `.iOS(.v16)`) imported by both ends — symmetric encode/decode, one source of truth.
- **Local-first privacy.** Logs persist only in the iPhone app container (complete file protection); the ICU-timeline export is an explicit opt-in tap; cleared on sign-out.
- **Safety by construction.** Only measurable values shown (count, est. rate, elapsed, pause). No depth, no quality/adequacy claims. Coach copy is neutral rate-matching ("Faster"/"On target"/"Slower"). Disclaimer everywhere: *"Motion-based estimates — not a measure of CPR quality or depth."*
- **Future-proofing.** `CodeBlueSyncService` protocol + `sourceDeviceId` on every event let BLE defibrillators, multipeer multi-watch team logging, Apple Watch ECG, and FHIR export be added without UI/model changes.
- **Battery.** 50 Hz sampling (Nyquist-safe for ~2 Hz compressions); detector + workout session torn down on End/ROSC.

## Testing performed

- **Core unit tests:** 191 pass (180 pre-existing + 11 new), 0 failures. New coverage: analyzer count/rate at 110 cpm, single-bump rejection (repetition gate), pause→resume; rate-zone boundaries (99/100/120/121) + idle; summary aggregation (pauses, longest pause, shock/drug timelines); model timeline/stats/snapshot via the mock detector; pause/resume event emission.
- **Watch build** (`StewardMDWatch`, watchOS 27 sim): `BUILD SUCCEEDED`, zero warnings.
- **iOS build** (`App`, generic iOS): `BUILD SUCCEEDED`, zero warnings.
- **Web bundle:** `build:www` + `cap copy ios` succeed; the Code Blue card, export listener, and `currentOpenPatient` are present in the copied bundle.
- Fixed during implementation: two Swift 6 concurrency issues in the HealthKit keep-alive `end()` (main-actor capture + latent "finish never called" bug), resolved with an async main-actor finish.

## Manual step required (one-time)

Enable **HealthKit + Workout** on the StewardMDWatch target in Xcode (see `docs/APPLE_WATCH.md`). Without it, CPR Assist falls back to CoreMotion-only automatically — no code change needed.

## Future improvements

- **Bluetooth defibrillator / external CPR feedback devices** — a `CodeBlueSyncService` impl feeding real depth/rate; would let the app report device-measured depth (which motion cannot).
- **Multi-watch team logging** — one watch tracks compressions while teammates log meds/shocks; the `sourceDeviceId`-tagged, merge-by-id timeline already supports it; needs a shared transport (multipeer or a cloud relay).
- **Apple Watch ECG / rhythm hints**, **FHIR / hospital-system export** of the code record.
- **Adaptive detection tuning** — per-user calibration of the peak threshold; on-watch review of the compression-rate trend.
