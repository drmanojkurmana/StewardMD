# Code Blue: CPR Assist (Apple Watch) + Command Center (iPhone) — Design

**Date:** 2026-07-20
**Status:** Approved (design), pending implementation plan
**Scope:** Two coupled deliverables sharing one data contract — extend the existing
watch Code Blue module with a real-time CPR assistant (Part A), and add a native
iPhone Code Blue Command Center that mirrors it live (Part B).

---

## 0. Guiding constraints

- **Additive only.** Preserve every existing Code Blue feature. Do not create a
  parallel module; extend what exists. Do not break existing tests (180 green in
  `StewardMDWatchCore`) or existing watch/phone/web flows.
- **Safety — decision support only.** NEVER claim CPR quality, adequacy, or
  effectiveness. NEVER estimate or display compression depth. Show ONLY
  measurable values: motion-derived compression **count**, **estimated rate**
  (always labeled "est."), **elapsed time**, and **pause duration**. A persistent
  disclaimer is shown on both the watch dashboard and the phone Command Center and
  in the summary: *"Motion-based estimates — not a measure of CPR quality or depth."*
- **Privacy.** All Code Blue event logs are stored **locally on the paired iPhone
  only** (app container, iOS file protection at rest). Nothing leaves the device
  except an explicit user Export. No cloud upload by default. On sign-out, prompt
  to clear logs.
- **Architecture.** SwiftUI, MVVM, Swift Concurrency, Combine/Observation,
  protocol-oriented, dependency injection, modular. **All motion processing is
  isolated in a reusable service; the UI never touches CoreMotion directly.**
- **Battery.** Motion sampling and the workout keep-alive run only while a code is
  active and are torn down on End/ROSC.

---

## 1. What already exists (reuse — do not rebuild)

| Concern | Existing owner | Reused how |
| --- | --- | --- |
| Shock count, adrenaline count, ROSC, 2-min cycle timer + boundary haptic, next-drug guidance, `end()→summary` | `CodeBlueModel` (`@MainActor`) | Extended additively (timeline, compression stats, richer summary) |
| Pure cycle math (cycle #, seconds to next rhythm check) | `CodeBlueTimer` | Unchanged |
| Elapsed clock, cycle/rhythm countdown, next-drug card, Rhythm/Adren/Shock buttons, Start/End, summary line, repeating 2-min `ResusAlerts` notification | `CodeBlueView` | Extended with the CPR dashboard mode |
| Haptics, severity chip, palette/spacing/time-format, local notifications | `HapticManager`, `SeverityChip`, `SMDPalette`/`SMDSpacing`/`TimeFormat`, `ResusAlerts` | Reused |
| Watch→phone relay (`sendMessage`/`transferUserInfo`, routed by `kind`) | `WatchConnectivityManager` (watch), `WatchConnectivityRelay` (phone plugin) | Extended with `codeBlue*` kinds |
| Direct-API timeline append + `/api/watch/timeline` + `native-watch.js` routing | `AppAPI.appendTimeline`, Pages Function, JS bridge | Reused only for the **opt-in Export** |
| Shared Codable models package (already `.iOS(.v16)`) | `StewardMDWatchCore` | Hosts the new shared wire contract |

---

## 2. Shared data contract (single source of truth)

Defined once in `StewardMDWatchCore` (already builds for watchOS/iOS/macOS) and
imported by both the watch app and the iPhone plugin, so encode/decode is symmetric.

- `CodeEvent` — `{ id: String, elapsed: TimeInterval, kind, label, sourceDeviceId }`
  where `kind ∈ { cprStart, shock, drug, pauseStart, resume, switchCompressor,
  rosc, cprEnd }`. `sourceDeviceId` is carried on every event so a future
  multi-source timeline merges cleanly.
- `CodeSummary` — `{ durationLabel, totalCompressions, avgRateCPM, pauseCount,
  totalPauseSeconds, longestPauseSeconds, shocks: [CodeEvent], drugs: [CodeEvent],
  rosc: Bool, disclaimer: String }` + a `formattedDetail()` producing the export text.
- `CodeBlueState` — the live snapshot streamed to the phone: `{ running, elapsed,
  cycle, compressionCount, instantaneousRateCPM, averageRateCPM, coachZone, paused,
  pauseSeconds, adrenalineCount, shockCount, rosc, batteryLevel, events: [CodeEvent] }`.

All `Codable`, `Sendable`, `Equatable`. These are pure value types — no framework
imports — so they compile everywhere and are unit-testable on macOS.

---

## 3. Part A — CPR Assist (Apple Watch)

### 3.1 Pure, testable core (in `StewardMDWatchCore`, no CoreMotion import)

- **`CompressionAnalyzer`** — the detection algorithm. Input: a stream of
  acceleration-magnitude samples `(t, mag)`. It peak-detects compressions with:
  - an **adaptive threshold** (relative to a running signal baseline/envelope),
  - a **refractory window ~250 ms** (min interval between counted peaks → no
    double-counting; caps at ~240 cpm),
  - a **repetition gate** — requires ~3 consecutive rhythmic peaks (consistent
    inter-peak interval) before it begins counting, so a single accidental arm
    movement is rejected.
  Outputs: running `count`, `instantaneousRateCPM` (from the latest inter-peak
  interval), `averageRateCPM` (rolling), and pause state.
- **Pause detection** — no qualifying peak for **~3 s** → `paused = true` +
  `pauseSeconds`; auto-resumes on the next qualifying peak (emits `pauseStart` /
  `resume` events).
- **`RateCoach`** — maps rate → zone against the AHA target band:
  **Faster** (`< 100`), **On target** (`100–120`), **Slower** (`> 120`). Returns a
  calm color token and a haptic cadence. Neutral *rate-matching* guidance only —
  never a quality verdict.

### 3.2 Isolated device I/O (watch app target, behind `#if canImport(...)`)

- **`CompressionDetecting`** protocol — `start()`, `stop()`, publishes
  `CompressionState`. The VM/UI depend only on this (DI).
  - `CoreMotionCompressionDetector` — owns `CMMotionManager` device-motion at a
    bounded **~50 Hz** (Nyquist-safe for ~2 Hz compressions; not max rate), feeds
    samples to `CompressionAnalyzer`, publishes on the main actor. **The only file
    that imports CoreMotion.**
  - `MockCompressionDetector` (in Core) — drives synthetic states for previews/tests.
- **`WorkoutKeepAlive`** protocol — keeps sensors + app alive during the code.
  - `HealthKitWorkoutKeepAlive` — wraps `HKWorkoutSession` (+ live builder);
    `#if canImport(HealthKit)`. Started on CPR start, ended on stop.
    **Degrades silently to CoreMotion-only** if HealthKit is unavailable/denied.
    Requires the HealthKit + Workout capability to be enabled once in Xcode
    (documented in the implementation notes).

### 3.3 Model & UI (additive)

- **`CodeBlueModel`** gains (additively; all existing published props/methods stay):
  injected `CompressionDetecting` + `WorkoutKeepAlive` (DI, defaulting to the real
  impls on device / mocks in tests), live compression count / est. rate / coach
  zone / pause state, a `[CodeEvent]` timeline, timestamped shock/ROSC, drug logging
  extended to **Epinephrine / Amiodarone / Other**, and a richer `CodeSummary`.
- **`CodeBlueView`** gains a **CPR dashboard mode while running**: large compression
  count, color-coded rate coach, cycle countdown + **"Switch Compressor"** prompt at
  the 2-min boundary (reuses existing cycle detection + haptic + `ResusAlerts`),
  a pause banner, and a Digital-Crown-scrollable live timeline — alongside the
  preserved shock/drug/ROSC/Start/End controls. Always-On-friendly, high-contrast,
  large type, haptics, full accessibility labels.

### 3.4 Watch → phone streaming (revised: no auto ICU sync)

The watch **streams** live Code Blue data to the phone; it does **not** auto-sync to
the ICU timeline anymore (export is now an opt-in phone action). It still shows its
own local post-code summary. Transport detailed in §5.

---

## 4. Part B — Code Blue Command Center (iPhone, native SwiftUI)

### 4.1 Entry & presentation

A premium **"Code Blue" card** on the web home screen, gated to native iOS with a
paired watch (hidden / "open in the app" elsewhere). Tapping it calls a new plugin
method **`CodeBlue.open()`** which presents a **full-screen native SwiftUI Command
Center** via `UIHostingController` from the Capacitor bridge view controller.

### 4.2 Single-delegate ingest (critical constraint)

`WCSession.default.delegate` allows exactly one delegate, already held by
`WatchConnectivityRelay` in the watch-bridge plugin. All live Code Blue data flows
**through that existing delegate**, which posts a `NotificationCenter` event (same
pattern as today's `taskStatus`/`labAck`). A singleton **`CodeBlueLiveModel`**
(`@MainActor ObservableObject`) observes it, decodes, updates `@Published` state, and
persists locally — living and persisting **even when the screen is closed**, so the
timeline is complete and reopening restores state. SwiftUI views bind to it.

### 4.3 Displayed data

Live CPR timer, compression count, est. rate ("est."), pause state, compressor-change
reminder, shock timeline, drug timeline, ROSC status, code duration, source-tagged
team event timeline, **watch connection status** (`isReachable` + last-received age),
**watch battery** (`WKInterfaceDevice.batteryLevel` from the payload), and on End the
auto summary with an **"Export to patient record"** button (opt-in) plus a native
share sheet. Visual language: Fitness rings + Health + Emergency SOS — large numerals,
red accent, dark, glanceable, high-contrast. Same safety disclaimer.

### 4.4 Placement

The Command Center feature (SwiftUI views, `CodeBlueLiveModel`, `CodeBlueSyncService`)
lives **inside the existing `capacitor-watch-bridge` plugin** (least new wiring; the
plugin already owns the phone-side `WCSession` and is linked into the iOS app).
Internal folders + protocols keep it modular.

---

## 5. Sync architecture (background-safe + auto-recovery)

Three-tier transport, all routed by message `kind`:

1. **`sendMessage`** (immediate, reachable-only) → live-feeling timer / compression
   count / rate (`kind: "codeBlueLive"`).
2. **`transferUserInfo`** periodic full snapshots (guaranteed, queued, background-safe)
   → the complete event list for **automatic recovery after a disconnect**
   (`kind: "codeBlueSnapshot"`); the phone **merges by `CodeEvent.id`** (dedupe).
3. **`updateApplicationContext`** latest-state snapshot → survives phone app relaunch
   (read from `receivedApplicationContext` on activation).

Local persistence on the phone means the Command Center restores the last state even
if the watch is off. On reconnect, the newest snapshot reconciles the timeline.

**Reusable service boundary:** ingest is behind a **`CodeBlueSyncService`** protocol.
Current impl = WatchConnectivity. Future impls (Bluetooth defibrillator, Multipeer
multi-watch, Apple Watch ECG, FHIR / hospital systems) conform without touching the
UI or model. Every event's `sourceDeviceId` lets a unified multi-source timeline merge
cleanly — the multi-watch *transport* is out of scope now, but the *data model*
already supports it.

**Export (opt-in only):** the "Export to patient record" button appends
`CodeSummary.formattedDetail()` to the current ICU patient's timeline via the existing
`AppAPI.appendTimeline` / `/api/watch/timeline` path **when a patient is in context**,
and always offers a native share sheet. Nothing is uploaded without this tap.

---

## 6. Testing

- **Core unit tests (`swift test`, macOS):**
  - `CompressionAnalyzer` — synthetic 100 / 110 / 120 cpm waveforms → count & rate
    within tolerance; a single bump → 0 (repetition gate); a gap → pause then resume.
  - `RateCoach` — zone boundaries at 99 / 100 / 120 / 121.
  - `CodeSummary` — aggregation of pause count, longest pause, shock/drug timelines.
  - `CodeBlueModel` with `MockCompressionDetector` — additive timeline/stat behavior;
    existing assertions stay green.
- **Builds:** watch (`-scheme StewardMDWatch`) and iOS (`-scheme App`) build with **no
  warnings or errors**; CoreMotion/HealthKit code behind `#if canImport`.
- All existing 180 Core tests remain green.

---

## 7. Deliverable report (to produce at the end of implementation)

Files modified, files created, architecture decisions, testing performed, and future
improvements — as requested.

---

## 8. Out of scope (explicit)

- Multi-watch team logging *transport* (data model supports it; no transport now).
- Bluetooth defibrillator / external CPR feedback / Apple Watch ECG / FHIR
  integrations (service boundary is designed to accept them later).
- Any claim, score, or display of CPR quality, adequacy, or compression depth.
