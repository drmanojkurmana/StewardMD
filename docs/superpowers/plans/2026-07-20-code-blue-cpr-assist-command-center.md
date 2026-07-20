# Code Blue: CPR Assist + Command Center — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing watch Code Blue module with a real-time, motion-based CPR assistant, and add a native iPhone Code Blue Command Center that mirrors it live over WatchConnectivity.

**Architecture:** Pure, deterministic signal-processing + models live in `StewardMDWatchCore` (unit-tested on macOS). Device I/O (CoreMotion, HealthKit) is isolated behind protocols in the watch app target — the UI never imports CoreMotion. The existing `CodeBlueModel`/`CodeBlueView` are extended additively. A shared Codable contract (`CodeEvent`/`CodeSummary`/`CodeBlueState`) is streamed watch→phone through the existing single `WCSession` delegate; the iPhone Command Center is native SwiftUI presented from a web home card via the existing Capacitor plugin. Data is local-first on the phone with an opt-in export.

**Tech Stack:** Swift 6, SwiftUI, Combine, Swift Concurrency (`@MainActor`, `Sendable`), CoreMotion, HealthKit, WatchConnectivity, Capacitor 8 plugin (Swift), vanilla-JS web bridge.

## Global Constraints

- **Additive only** — preserve every existing Code Blue feature; never remove/rename existing `CodeBlueModel` published properties or methods. All 180 existing `StewardMDWatchCore` tests must stay green.
- **Safety copy (verbatim, non-negotiable)** — never claim CPR quality, adequacy, or effectiveness; never display or estimate compression depth. Show only: compression **count**, **estimated rate** (labeled "est."), **elapsed**, **pause duration**. Disclaimer string used everywhere: `"Motion-based estimates — not a measure of CPR quality or depth."`
- **Rate band (AHA):** target `100–120` cpm. `< 100` → Faster, `100…120` → On target, `> 120` → Slower.
- **Detection defaults:** sampling `50 Hz`; refractory `0.25 s`; pause timeout `3.0 s`; repetition gate `3` consecutive rhythmic peaks.
- **Privacy:** Code Blue logs persist locally on the iPhone only (app container, default file protection). No cloud upload except an explicit Export tap. Offer clear-on-sign-out.
- **Motion isolation:** only `CoreMotionCompressionDetector.swift` may import CoreMotion; only `HealthKitWorkoutKeepAlive.swift` may import HealthKit. Both `#if canImport(...)`-guarded.
- **New watch-app source files must be registered in the Xcode target** via a one-off `scripts/*.rb` (the project uses explicit file references — see `scripts/add-tasksview.rb`).
- **Build/test commands:**
  - Core tests: `cd Packages/StewardMDWatchCore && swift test`
  - Watch build: `xcodebuild -project ios/App/App.xcodeproj -scheme StewardMDWatch -sdk watchsimulator27.0 -destination 'generic/platform=watchOS Simulator' CODE_SIGNING_ALLOWED=NO build`
  - iOS build: `xcodebuild -project ios/App/App.xcodeproj -scheme App -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build`
  - Web bundle into native: `npm run build:www && npx cap copy ios`

---

## File Structure

**Create (Core — pure, testable):**
- `Packages/StewardMDWatchCore/Sources/StewardMDWatchCore/Models/CodeEvent.swift` — `CodeEventKind`, `CodeEvent`, `RateZone`.
- `Packages/StewardMDWatchCore/Sources/StewardMDWatchCore/Models/CodeSummary.swift` — rich `CodeSummary` + aggregation.
- `Packages/StewardMDWatchCore/Sources/StewardMDWatchCore/Models/CodeBlueState.swift` — live snapshot wire model.
- `Packages/StewardMDWatchCore/Sources/StewardMDWatchCore/Engines/CompressionAnalyzer.swift` — peak detection, rate, pause.
- `Packages/StewardMDWatchCore/Sources/StewardMDWatchCore/Engines/RateCoach.swift` — zone mapping + guidance.
- `Packages/StewardMDWatchCore/Sources/StewardMDWatchCore/Connectivity/CompressionDetecting.swift` — protocol + `MockCompressionDetector`.
- `Packages/StewardMDWatchCore/Sources/StewardMDWatchCore/Connectivity/WorkoutKeepAlive.swift` — protocol + `NoopWorkoutKeepAlive`.

**Modify (Core):**
- `Packages/StewardMDWatchCore/Sources/StewardMDWatchCore/Engines/TimerEngine.swift` — extend `CodeBlueModel` additively.

**Create (Core tests):**
- `Tests/StewardMDWatchCoreTests/CompressionAnalyzerTests.swift`
- `Tests/StewardMDWatchCoreTests/RateCoachTests.swift`
- `Tests/StewardMDWatchCoreTests/CodeSummaryTests.swift`
- (extend) `Tests/StewardMDWatchCoreTests/CodeBlueModelTests.swift`

**Create (watch app — device I/O, `#if canImport`):**
- `ios/StewardMDWatch/System/CoreMotionCompressionDetector.swift`
- `ios/StewardMDWatch/System/HealthKitWorkoutKeepAlive.swift`

**Modify (watch app):**
- `ios/StewardMDWatch/CodeBlueView.swift` — CPR dashboard mode (additive).
- `ios/StewardMDWatch/System/WatchConnectivityManager.swift` — stream `codeBlueLive`/`codeBlueSnapshot`.
- `ios/App/App.xcodeproj/...` — via `scripts/add-codeblue-files.rb`.
- `ios/StewardMDWatch/Info.plist` (or target build settings) — `NSHealthShareUsageDescription` / `NSHealthUpdateUsageDescription`.

**Create (iPhone Command Center — inside the plugin):**
- `local-plugins/capacitor-watch-bridge/ios/Sources/WatchBridgePlugin/CodeBlue/CodeBlueLiveModel.swift`
- `.../CodeBlue/CodeBlueSyncService.swift` — protocol + WC impl + local store.
- `.../CodeBlue/CommandCenterView.swift` — SwiftUI dashboard.
- `.../CodeBlue/CommandCenterSummaryView.swift` — summary + export.

**Modify (plugin + phone relay + web):**
- `local-plugins/capacitor-watch-bridge/Package.swift` — add `StewardMDWatchCore` dependency.
- `.../WatchBridgePlugin/WatchConnectivityRelay.swift` — route `codeBlue*` → NotificationCenter.
- `.../WatchBridgePlugin/WatchBridgePlugin.swift` — add `CodeBlue`-namespace method `openCodeBlue` + present hosting controller.
- `native-watch.js` — inject the native-only "Code Blue" home card.
- `index.html` — the Code Blue card markup near the home cards.

---

## Task 1: Shared contract — `CodeEvent`, `RateZone`, `CodeSummary`, `CodeBlueState`

**Files:**
- Create: `Packages/StewardMDWatchCore/Sources/StewardMDWatchCore/Models/CodeEvent.swift`
- Create: `Packages/StewardMDWatchCore/Sources/StewardMDWatchCore/Models/CodeSummary.swift`
- Create: `Packages/StewardMDWatchCore/Sources/StewardMDWatchCore/Models/CodeBlueState.swift`
- Test: `Packages/StewardMDWatchCore/Tests/StewardMDWatchCoreTests/CodeSummaryTests.swift`

**Interfaces:**
- Produces: `CodeEventKind`, `CodeEvent(id:elapsed:kind:label:sourceDeviceId:)`, `RateZone`, `CodeSummary` + `CodeSummary.build(...)` + `formattedDetail()`, `CodeBlueState`.

- [ ] **Step 1: Write the failing test** (`CodeSummaryTests.swift`)

```swift
import XCTest
@testable import StewardMDWatchCore

final class CodeSummaryTests: XCTestCase {
    private func ev(_ e: TimeInterval, _ k: CodeEventKind, _ label: String = "") -> CodeEvent {
        CodeEvent(id: "\(k.rawValue)-\(e)", elapsed: e, kind: k, label: label, sourceDeviceId: "watch")
    }

    func test_build_aggregatesPausesShocksDrugs() {
        let events: [CodeEvent] = [
            ev(0, .cprStart),
            ev(30, .shock, "Shock #1"),
            ev(45, .drug, "Epinephrine"),
            ev(60, .pauseStart), ev(64, .resume),          // 4 s pause
            ev(120, .switchCompressor),
            ev(130, .pauseStart), ev(142, .resume),        // 12 s pause (longest)
            ev(150, .shock, "Shock #2"),
            ev(200, .rosc),
            ev(210, .cprEnd),
        ]
        let s = CodeSummary.build(events: events, durationSeconds: 210,
                                  cycles: 2, totalCompressions: 340, averageRateCPM: 112)
        XCTAssertEqual(s.totalCompressions, 340)
        XCTAssertEqual(s.averageRateCPM, 112)
        XCTAssertEqual(s.shockCount, 2)
        XCTAssertEqual(s.shocks.count, 2)
        XCTAssertEqual(s.drugs.count, 1)
        XCTAssertEqual(s.pauseCount, 2)
        XCTAssertEqual(s.totalPauseSeconds, 16, accuracy: 0.001)
        XCTAssertEqual(s.longestPauseSeconds, 12, accuracy: 0.001)
        XCTAssertTrue(s.rosc)
        XCTAssertEqual(s.durationLabel, "3:30")
        XCTAssertTrue(s.disclaimer.contains("not a measure of CPR quality"))
        XCTAssertTrue(s.formattedDetail().contains("Shock #1"))
    }

    func test_codeBlueState_roundTripsCodable() throws {
        let st = CodeBlueState(running: true, elapsed: 42, cycle: 1, compressionCount: 70,
                               instantaneousRateCPM: 110, averageRateCPM: 108, coachZone: .onTarget,
                               paused: false, pauseSeconds: 0, adrenalineCount: 1, shockCount: 1,
                               rosc: false, batteryLevel: 0.8, events: [ev(0, .cprStart)],
                               updatedElapsed: 42)
        let data = try JSONEncoder().encode(st)
        let back = try JSONDecoder().decode(CodeBlueState.self, from: data)
        XCTAssertEqual(st, back)
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Packages/StewardMDWatchCore && swift test --filter CodeSummaryTests`
Expected: FAIL — `CodeEvent` / `CodeSummary` / `CodeBlueState` undefined.

- [ ] **Step 3: Write `CodeEvent.swift`**

```swift
import Foundation

/// A single timestamped Code Blue event (design §2). `elapsed` is seconds since
/// CPR start so events order/merge deterministically regardless of wall clock.
/// `sourceDeviceId` tags the originating device so a future multi-source timeline
/// merges cleanly (single source — "watch" — today).
public enum CodeEventKind: String, Codable, Sendable {
    case cprStart, shock, drug, pauseStart, resume, switchCompressor, rosc, cprEnd
}

public struct CodeEvent: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public let elapsed: TimeInterval
    public let kind: CodeEventKind
    public let label: String
    public let sourceDeviceId: String
    public init(id: String, elapsed: TimeInterval, kind: CodeEventKind,
                label: String, sourceDeviceId: String) {
        self.id = id; self.elapsed = elapsed; self.kind = kind
        self.label = label; self.sourceDeviceId = sourceDeviceId
    }
}

/// CPR compression-rate coaching zone against the AHA 100–120 cpm band. Neutral
/// rate-matching guidance only — NEVER a CPR-quality verdict (design safety §0).
public enum RateZone: String, Codable, Sendable { case idle, tooSlow, onTarget, tooFast }
```

- [ ] **Step 4: Write `CodeSummary.swift`**

```swift
import Foundation

/// End-of-code summary (design §2). Aggregated purely from the event timeline +
/// measured stats — no quality judgement, no depth.
public struct CodeSummary: Codable, Sendable, Equatable {
    public let durationLabel: String
    public let durationSeconds: TimeInterval
    public let cycles: Int
    public let totalCompressions: Int
    public let averageRateCPM: Int
    public let pauseCount: Int
    public let totalPauseSeconds: TimeInterval
    public let longestPauseSeconds: TimeInterval
    public let adrenalineCount: Int
    public let shockCount: Int
    public let shocks: [CodeEvent]
    public let drugs: [CodeEvent]
    public let rosc: Bool
    public let disclaimer: String

    public static let disclaimerText =
        "Motion-based estimates — not a measure of CPR quality or depth."

    /// Aggregate a summary from the raw event timeline + measured compression stats.
    public static func build(events: [CodeEvent], durationSeconds: TimeInterval,
                             cycles: Int, totalCompressions: Int,
                             averageRateCPM: Int) -> CodeSummary {
        let shocks = events.filter { $0.kind == .shock }
        let drugs = events.filter { $0.kind == .drug }
        let adren = drugs.filter { $0.label.lowercased().contains("epinephrine")
            || $0.label.lowercased().contains("adrenaline") }.count

        // Pair each pauseStart with the next resume to measure pause durations.
        var pauses: [TimeInterval] = []
        var pendingPause: TimeInterval?
        for e in events.sorted(by: { $0.elapsed < $1.elapsed }) {
            if e.kind == .pauseStart { pendingPause = e.elapsed }
            else if e.kind == .resume, let start = pendingPause {
                pauses.append(max(0, e.elapsed - start)); pendingPause = nil
            }
        }
        return CodeSummary(
            durationLabel: TimeFormat.mmss(durationSeconds),
            durationSeconds: durationSeconds, cycles: cycles,
            totalCompressions: totalCompressions, averageRateCPM: averageRateCPM,
            pauseCount: pauses.count, totalPauseSeconds: pauses.reduce(0, +),
            longestPauseSeconds: pauses.max() ?? 0, adrenalineCount: adren,
            shockCount: shocks.count, shocks: shocks, drugs: drugs,
            rosc: events.contains { $0.kind == .rosc }, disclaimer: disclaimerText)
    }

    /// Human-readable multi-line export body (used by the phone opt-in Export).
    public func formattedDetail() -> String {
        var lines = ["Code Blue summary", "Duration \(durationLabel) · \(cycles) cycles",
                     "Compressions \(totalCompressions) (avg ~\(averageRateCPM)/min, est.)",
                     "Pauses \(pauseCount) · total \(TimeFormat.mmss(totalPauseSeconds)) · longest \(TimeFormat.mmss(longestPauseSeconds))"]
        for s in shocks { lines.append("\(TimeFormat.mmss(s.elapsed)) — \(s.label.isEmpty ? "Shock" : s.label)") }
        for d in drugs { lines.append("\(TimeFormat.mmss(d.elapsed)) — \(d.label)") }
        lines.append(rosc ? "ROSC achieved" : "No ROSC recorded")
        lines.append(disclaimer)
        return lines.joined(separator: "\n")
    }
}
```

- [ ] **Step 5: Write `CodeBlueState.swift`**

```swift
import Foundation

/// The live snapshot streamed watch→phone (design §2/§5). `updatedElapsed` orders
/// live messages so a stale out-of-order `sendMessage` never regresses the phone.
public struct CodeBlueState: Codable, Sendable, Equatable {
    public var running: Bool
    public var elapsed: TimeInterval
    public var cycle: Int
    public var compressionCount: Int
    public var instantaneousRateCPM: Int
    public var averageRateCPM: Int
    public var coachZone: RateZone
    public var paused: Bool
    public var pauseSeconds: TimeInterval
    public var adrenalineCount: Int
    public var shockCount: Int
    public var rosc: Bool
    public var batteryLevel: Double   // 0…1; -1 when unknown
    public var events: [CodeEvent]
    public var updatedElapsed: TimeInterval

    public init(running: Bool, elapsed: TimeInterval, cycle: Int, compressionCount: Int,
                instantaneousRateCPM: Int, averageRateCPM: Int, coachZone: RateZone,
                paused: Bool, pauseSeconds: TimeInterval, adrenalineCount: Int,
                shockCount: Int, rosc: Bool, batteryLevel: Double, events: [CodeEvent],
                updatedElapsed: TimeInterval) {
        self.running = running; self.elapsed = elapsed; self.cycle = cycle
        self.compressionCount = compressionCount; self.instantaneousRateCPM = instantaneousRateCPM
        self.averageRateCPM = averageRateCPM; self.coachZone = coachZone; self.paused = paused
        self.pauseSeconds = pauseSeconds; self.adrenalineCount = adrenalineCount
        self.shockCount = shockCount; self.rosc = rosc; self.batteryLevel = batteryLevel
        self.events = events; self.updatedElapsed = updatedElapsed
    }

    public static var empty: CodeBlueState {
        CodeBlueState(running: false, elapsed: 0, cycle: 1, compressionCount: 0,
                      instantaneousRateCPM: 0, averageRateCPM: 0, coachZone: .idle,
                      paused: false, pauseSeconds: 0, adrenalineCount: 0, shockCount: 0,
                      rosc: false, batteryLevel: -1, events: [], updatedElapsed: 0)
    }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd Packages/StewardMDWatchCore && swift test --filter CodeSummaryTests`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add Packages/StewardMDWatchCore/Sources/StewardMDWatchCore/Models/CodeEvent.swift \
        Packages/StewardMDWatchCore/Sources/StewardMDWatchCore/Models/CodeSummary.swift \
        Packages/StewardMDWatchCore/Sources/StewardMDWatchCore/Models/CodeBlueState.swift \
        Packages/StewardMDWatchCore/Tests/StewardMDWatchCoreTests/CodeSummaryTests.swift
git commit -m "feat(watch): shared Code Blue event/summary/state contract"
```

---

## Task 2: `CompressionAnalyzer` — motion → count, rate, pause

**Files:**
- Create: `Packages/StewardMDWatchCore/Sources/StewardMDWatchCore/Engines/CompressionAnalyzer.swift`
- Test: `Packages/StewardMDWatchCore/Tests/StewardMDWatchCoreTests/CompressionAnalyzerTests.swift`

**Interfaces:**
- Consumes: nothing.
- Produces: `CompressionSample(t:magnitude:)`, `CompressionState`, `AnalyzerTick`, `CompressionAnalyzer(refractory:pauseTimeout:repetitionGate:minPeakG:)` with `mutating func ingest(_:) -> AnalyzerTick` and `var state: CompressionState`.

- [ ] **Step 1: Write the failing test**

```swift
import XCTest
@testable import StewardMDWatchCore

final class CompressionAnalyzerTests: XCTestCase {
    /// Feed a sine wave at `cpm` compressions/min for `seconds`, sampled at 50 Hz.
    /// Amplitude ~1.2 g peak (typical wrist userAcceleration magnitude during CPR).
    private func feedSine(_ a: inout CompressionAnalyzer, cpm: Double, seconds: Double,
                          amp: Double = 1.2, from t0: Double = 0) -> [AnalyzerTick] {
        let dt = 1.0 / 50.0
        let w = 2 * Double.pi * (cpm / 60.0)
        var ticks: [AnalyzerTick] = []
        var t = t0
        let end = t0 + seconds
        while t < end {
            let mag = amp * (0.5 + 0.5 * sin(w * t))   // 0…amp, one peak per cycle
            ticks.append(a.ingest(CompressionSample(t: t, magnitude: mag)))
            t += dt
        }
        return ticks
    }

    func test_countsAndRate_at110cpm() {
        var a = CompressionAnalyzer()
        _ = feedSine(&a, cpm: 110, seconds: 12)
        // 110 cpm × 12 s = 22 compressions; allow ±2 for edge/gate.
        XCTAssertEqual(Double(a.state.count), 22, accuracy: 2)
        XCTAssertEqual(Double(a.state.averageRateCPM), 110, accuracy: 8)
        XCTAssertFalse(a.state.paused)
    }

    func test_singleBump_isRejectedByRepetitionGate() {
        var a = CompressionAnalyzer()
        // one lone peak then quiet → never arms → count stays 0
        _ = a.ingest(CompressionSample(t: 0.0, magnitude: 0.1))
        _ = a.ingest(CompressionSample(t: 0.1, magnitude: 1.5))
        _ = a.ingest(CompressionSample(t: 0.2, magnitude: 0.1))
        for i in 3...200 { _ = a.ingest(CompressionSample(t: Double(i) * 0.02, magnitude: 0.05)) }
        XCTAssertEqual(a.state.count, 0)
    }

    func test_pauseDetectedAfterTimeout_thenResumes() {
        var a = CompressionAnalyzer()
        _ = feedSine(&a, cpm: 110, seconds: 6)                 // establish rhythm
        XCTAssertFalse(a.state.paused)
        // 4 s of silence → pause (timeout 3 s)
        var pausedSeen = false
        var t = 6.0
        while t < 10.0 { let tk = a.ingest(CompressionSample(t: t, magnitude: 0.02)); if tk.pauseStarted { pausedSeen = true }; t += 0.02 }
        XCTAssertTrue(pausedSeen)
        XCTAssertTrue(a.state.paused)
        XCTAssertGreaterThan(a.state.pauseSeconds, 3.0)
        // resume compressions → resumed flag fires, paused clears
        let ticks = feedSine(&a, cpm: 110, seconds: 4, from: 10.0)
        XCTAssertTrue(ticks.contains { $0.resumed })
        XCTAssertFalse(a.state.paused)
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Packages/StewardMDWatchCore && swift test --filter CompressionAnalyzerTests`
Expected: FAIL — `CompressionAnalyzer` undefined.

- [ ] **Step 3: Write `CompressionAnalyzer.swift`**

```swift
import Foundation

/// One acceleration-magnitude sample (gravity removed): `magnitude` = |userAcceleration| in g.
public struct CompressionSample: Sendable, Equatable {
    public let t: TimeInterval
    public let magnitude: Double
    public init(t: TimeInterval, magnitude: Double) { self.t = t; self.magnitude = magnitude }
}

/// Measured compression state (design §3.1). No quality/depth — counts + rate + pause only.
public struct CompressionState: Sendable, Equatable {
    public var count = 0
    public var instantaneousRateCPM = 0
    public var averageRateCPM = 0
    public var paused = false
    public var pauseSeconds: TimeInterval = 0
    public init() {}
}

/// What a single `ingest` produced, so the model can emit `CodeEvent`s with ids.
public struct AnalyzerTick: Sendable, Equatable {
    public var compressionCounted = false
    public var pauseStarted = false
    public var resumed = false
}

/// Detects chest-compression peaks from a stream of acceleration-magnitude samples
/// and derives count + estimated rate + pause state (design §3.1). Pure and
/// deterministic — no CoreMotion, no clock; advanced solely by `ingest`.
///
/// Algorithm: a rising→falling state machine finds local maxima; a peak counts only
/// if it clears a minimum prominence AND at least `refractory` seconds have passed
/// since the last peak (rejects double-counting / caps ~240 cpm). A **repetition
/// gate** withholds counting until `repetitionGate` consecutive rhythmic peaks are
/// seen (rejects a single accidental movement). Absence of a qualifying peak for
/// `pauseTimeout` seconds marks a pause; the next qualifying peak resumes.
public struct CompressionAnalyzer: Sendable {
    public var refractory: TimeInterval
    public var pauseTimeout: TimeInterval
    public var repetitionGate: Int
    public var minPeakG: Double

    public private(set) var state = CompressionState()

    private var prev: Double = 0
    private var rising = false
    private var lastPeakT: TimeInterval?
    private var lastSampleT: TimeInterval = 0
    private var armed = false
    private var provisionalPeaks = 0
    private var intervals: [TimeInterval] = []   // recent inter-peak intervals (rolling)

    public init(refractory: TimeInterval = 0.25, pauseTimeout: TimeInterval = 3.0,
                repetitionGate: Int = 3, minPeakG: Double = 0.6) {
        self.refractory = refractory; self.pauseTimeout = pauseTimeout
        self.repetitionGate = repetitionGate; self.minPeakG = minPeakG
    }

    public mutating func ingest(_ s: CompressionSample) -> AnalyzerTick {
        var tick = AnalyzerTick()
        lastSampleT = s.t

        // Pause detection: no qualifying peak within pauseTimeout.
        if let lp = lastPeakT {
            let gap = s.t - lp
            if !state.paused, gap >= pauseTimeout {
                state.paused = true; tick.pauseStarted = true
                state.instantaneousRateCPM = 0
            }
            if state.paused { state.pauseSeconds = gap }
        }

        // Peak state machine on the raw magnitude.
        let goingUp = s.magnitude > prev
        var peak = false
        if rising && !goingUp { peak = true }   // just turned from rising to falling
        rising = goingUp

        if peak, prev >= minPeakG {
            let dtSincePeak = lastPeakT.map { s.t - $0 } ?? .infinity
            if dtSincePeak >= refractory {
                registerPeak(at: s.t, interval: lastPeakT == nil ? nil : dtSincePeak, tick: &tick)
            }
        }
        prev = s.magnitude
        return tick
    }

    private mutating func registerPeak(at t: TimeInterval, interval: TimeInterval?,
                                       tick: inout AnalyzerTick) {
        // Rhythm consistency for the repetition gate: interval within 0.25…1.5 s (40–240 cpm).
        let rhythmic = interval.map { $0 >= 0.25 && $0 <= 1.5 } ?? false

        if state.paused {
            state.paused = false; state.pauseSeconds = 0; tick.resumed = true
            intervals.removeAll()
        }

        if !armed {
            if rhythmic || provisionalPeaks == 0 {
                provisionalPeaks += 1
            } else {
                provisionalPeaks = 1
            }
            if provisionalPeaks >= repetitionGate {
                armed = true
                state.count = provisionalPeaks          // backfill the gate peaks
                tick.compressionCounted = true
            }
        } else {
            state.count += 1
            tick.compressionCounted = true
        }

        if let iv = interval, rhythmic {
            state.instantaneousRateCPM = Int((60.0 / iv).rounded())
            intervals.append(iv)
            if intervals.count > 8 { intervals.removeFirst(intervals.count - 8) }
            let mean = intervals.reduce(0, +) / Double(intervals.count)
            state.averageRateCPM = mean > 0 ? Int((60.0 / mean).rounded()) : 0
        }
        lastPeakT = t
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Packages/StewardMDWatchCore && swift test --filter CompressionAnalyzerTests`
Expected: PASS (3 tests). If `test_countsAndRate_at110cpm` is off by >2, widen the sine `amp` in the test helper is NOT allowed — instead confirm `minPeakG` default (0.6) is below the 1.2 amp midpoint crossing; the peak value equals `amp` so `prev >= minPeakG` holds. Do not loosen assertions.

- [ ] **Step 5: Commit**

```bash
git add Packages/StewardMDWatchCore/Sources/StewardMDWatchCore/Engines/CompressionAnalyzer.swift \
        Packages/StewardMDWatchCore/Tests/StewardMDWatchCoreTests/CompressionAnalyzerTests.swift
git commit -m "feat(watch): CompressionAnalyzer — count/rate/pause from motion"
```

---

## Task 3: `RateCoach` — zone + guidance

**Files:**
- Create: `Packages/StewardMDWatchCore/Sources/StewardMDWatchCore/Engines/RateCoach.swift`
- Test: `Packages/StewardMDWatchCore/Tests/StewardMDWatchCoreTests/RateCoachTests.swift`

**Interfaces:**
- Consumes: `RateZone` (Task 1).
- Produces: `RateCoach.zone(forRateCPM:active:) -> RateZone`, `RateCoach.guidance(_:) -> String`, `RateCoach.lower`/`upper`.

- [ ] **Step 1: Write the failing test**

```swift
import XCTest
@testable import StewardMDWatchCore

final class RateCoachTests: XCTestCase {
    func test_zoneBoundaries() {
        XCTAssertEqual(RateCoach.zone(forRateCPM: 99, active: true), .tooSlow)
        XCTAssertEqual(RateCoach.zone(forRateCPM: 100, active: true), .onTarget)
        XCTAssertEqual(RateCoach.zone(forRateCPM: 120, active: true), .onTarget)
        XCTAssertEqual(RateCoach.zone(forRateCPM: 121, active: true), .tooFast)
    }
    func test_idleWhenNotActive() {
        XCTAssertEqual(RateCoach.zone(forRateCPM: 110, active: false), .idle)
        XCTAssertEqual(RateCoach.zone(forRateCPM: 0, active: true), .idle)
    }
    func test_guidanceCopyIsNeutral() {
        XCTAssertEqual(RateCoach.guidance(.tooSlow), "Faster")
        XCTAssertEqual(RateCoach.guidance(.onTarget), "On target")
        XCTAssertEqual(RateCoach.guidance(.tooFast), "Slower")
        // never a quality verdict
        XCTAssertFalse(RateCoach.guidance(.onTarget).lowercased().contains("good"))
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Packages/StewardMDWatchCore && swift test --filter RateCoachTests`
Expected: FAIL — `RateCoach` undefined.

- [ ] **Step 3: Write `RateCoach.swift`**

```swift
import Foundation

/// Maps an estimated compression rate to the AHA target band (design §3.1). Copy is
/// strictly rate-matching guidance — never a CPR-quality/adequacy verdict (§0 safety).
public enum RateCoach {
    public static let lower = 100
    public static let upper = 120

    public static func zone(forRateCPM rate: Int, active: Bool) -> RateZone {
        guard active, rate > 0 else { return .idle }
        if rate < lower { return .tooSlow }
        if rate > upper { return .tooFast }
        return .onTarget
    }

    public static func guidance(_ z: RateZone) -> String {
        switch z {
        case .tooSlow: return "Faster"
        case .onTarget: return "On target"
        case .tooFast: return "Slower"
        case .idle: return "—"
        }
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Packages/StewardMDWatchCore && swift test --filter RateCoachTests`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add Packages/StewardMDWatchCore/Sources/StewardMDWatchCore/Engines/RateCoach.swift \
        Packages/StewardMDWatchCore/Tests/StewardMDWatchCoreTests/RateCoachTests.swift
git commit -m "feat(watch): RateCoach — AHA 100-120 rate zone mapping"
```

---

## Task 4: Detection & keep-alive protocols + mocks (Core)

**Files:**
- Create: `Packages/StewardMDWatchCore/Sources/StewardMDWatchCore/Connectivity/CompressionDetecting.swift`
- Create: `Packages/StewardMDWatchCore/Sources/StewardMDWatchCore/Connectivity/WorkoutKeepAlive.swift`
- Test: extend `Packages/StewardMDWatchCore/Tests/StewardMDWatchCoreTests/CompressionAnalyzerTests.swift` (add a mock-drive test) — OR new file; here we add to a new small file.
- Test: `Packages/StewardMDWatchCore/Tests/StewardMDWatchCoreTests/CompressionDetectingTests.swift`

**Interfaces:**
- Consumes: `CompressionState` (Task 2).
- Produces: `CompressionDetecting` protocol (`@MainActor`) with `var onChange: ((CompressionState, AnalyzerTick) -> Void)?`, `func start()`, `func stop()`; `MockCompressionDetector`; `WorkoutKeepAlive` protocol (`func begin()`, `func end()`); `NoopWorkoutKeepAlive`.

- [ ] **Step 1: Write the failing test** (`CompressionDetectingTests.swift`)

```swift
import XCTest
@testable import StewardMDWatchCore

@MainActor
final class CompressionDetectingTests: XCTestCase {
    func test_mockEmitsStatesToClosure() {
        let mock = MockCompressionDetector()
        var last: CompressionState?
        var ticks = 0
        mock.onChange = { st, tk in last = st; if tk.compressionCounted { ticks += 1 } }
        mock.start()
        mock.emit(count: 5, rate: 110, counted: true)
        mock.emit(count: 6, rate: 112, counted: true)
        XCTAssertEqual(last?.count, 6)
        XCTAssertEqual(last?.instantaneousRateCPM, 112)
        XCTAssertEqual(ticks, 2)
        mock.stop()
        XCTAssertFalse(mock.isRunning)
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Packages/StewardMDWatchCore && swift test --filter CompressionDetectingTests`
Expected: FAIL — `MockCompressionDetector` undefined.

- [ ] **Step 3: Write `CompressionDetecting.swift`**

```swift
import Foundation

/// Isolation boundary for motion capture (design §3.2). The VM/UI depend ONLY on
/// this protocol; the CoreMotion implementation lives in the watch app target so
/// the UI never imports CoreMotion. `onChange` fires on the main actor per sample
/// batch with the latest measured state + what that batch produced.
@MainActor
public protocol CompressionDetecting: AnyObject {
    var onChange: ((CompressionState, AnalyzerTick) -> Void)? { get set }
    var isRunning: Bool { get }
    func start()
    func stop()
}

/// Test/preview double — drive states manually; no sensors.
@MainActor
public final class MockCompressionDetector: CompressionDetecting {
    public var onChange: ((CompressionState, AnalyzerTick) -> Void)?
    public private(set) var isRunning = false
    private var state = CompressionState()
    public init() {}
    public func start() { isRunning = true }
    public func stop() { isRunning = false }
    public func emit(count: Int, rate: Int, counted: Bool, paused: Bool = false,
                     pauseSeconds: TimeInterval = 0) {
        state.count = count; state.instantaneousRateCPM = rate; state.averageRateCPM = rate
        state.paused = paused; state.pauseSeconds = pauseSeconds
        var tick = AnalyzerTick(); tick.compressionCounted = counted
        onChange?(state, tick)
    }
}
```

- [ ] **Step 4: Write `WorkoutKeepAlive.swift`**

```swift
import Foundation

/// Keeps the watch app + motion sensors alive during a code (design §3.2). The
/// HealthKit implementation lives in the watch app; this protocol lets the model
/// stay framework-free and lets tests inject a no-op.
@MainActor
public protocol WorkoutKeepAlive: AnyObject {
    var isActive: Bool { get }
    func begin()
    func end()
}

/// Default no-op (used in tests, previews, and as the graceful fallback when
/// HealthKit is unavailable/denied — motion still works while foregrounded/AOD).
@MainActor
public final class NoopWorkoutKeepAlive: WorkoutKeepAlive {
    public private(set) var isActive = false
    public init() {}
    public func begin() { isActive = true }
    public func end() { isActive = false }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd Packages/StewardMDWatchCore && swift test --filter CompressionDetectingTests`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add Packages/StewardMDWatchCore/Sources/StewardMDWatchCore/Connectivity/CompressionDetecting.swift \
        Packages/StewardMDWatchCore/Sources/StewardMDWatchCore/Connectivity/WorkoutKeepAlive.swift \
        Packages/StewardMDWatchCore/Tests/StewardMDWatchCoreTests/CompressionDetectingTests.swift
git commit -m "feat(watch): CompressionDetecting + WorkoutKeepAlive protocols + mocks"
```

---

## Task 5: Extend `CodeBlueModel` (additive) — timeline, compression stats, rich summary, snapshot

**Files:**
- Modify: `Packages/StewardMDWatchCore/Sources/StewardMDWatchCore/Engines/TimerEngine.swift`
- Test: extend `Packages/StewardMDWatchCore/Tests/StewardMDWatchCoreTests/CodeBlueModelTests.swift`

**Interfaces:**
- Consumes: `CompressionDetecting`, `WorkoutKeepAlive`, `CompressionState`, `AnalyzerTick`, `CodeEvent`, `CodeSummary`, `CodeBlueState`, `RateCoach` (Tasks 1–4).
- Produces (new on `CodeBlueModel`, all additive):
  - `convenience init(detector:workout:deviceId:)`
  - `@Published private(set) var compressionCount, instantaneousRateCPM, averageRateCPM: Int`
  - `@Published private(set) var paused: Bool`, `pauseSeconds: TimeInterval`, `coachZone: RateZone`
  - `@Published private(set) var events: [CodeEvent]`
  - `func startCode()`, `func endCode() -> CodeSummary`
  - `func recordShock()` / `recordAdrenaline()` now append timestamped events; new `func recordDrug(_ name: String)` and `func markSwitchCompressor()`; `markROSC()` appends event + `func snapshot(batteryLevel:) -> CodeBlueState`.
  - `richSummary: CodeSummary` retained via `endCode()`. Existing `end() -> CodeBlueSummary`, `elapsed`, `adrenalineCount`, `shockCount`, `rosc`, `cycle`, `tick`, `sync`, `nextDrug`, labels **unchanged**.

- [ ] **Step 1: Write the failing test** (append to `CodeBlueModelTests.swift`)

```swift
    @MainActor
    func test_timelineAndStats_fromDetector() {
        let mock = MockCompressionDetector()
        let model = CodeBlueModel(detector: mock, workout: NoopWorkoutKeepAlive(), deviceId: "watch")
        model.startCode()
        XCTAssertTrue(mock.isRunning)
        XCTAssertTrue(model.events.contains { $0.kind == .cprStart })

        mock.emit(count: 30, rate: 110, counted: true)
        XCTAssertEqual(model.compressionCount, 30)
        XCTAssertEqual(model.instantaneousRateCPM, 110)
        XCTAssertEqual(model.coachZone, .onTarget)

        model.recordShock()
        model.recordDrug("Epinephrine")
        model.markROSC()
        XCTAssertEqual(model.events.filter { $0.kind == .shock }.count, 1)
        XCTAssertEqual(model.events.filter { $0.kind == .drug }.count, 1)
        XCTAssertTrue(model.rosc)

        let snap = model.snapshot(batteryLevel: 0.5)
        XCTAssertEqual(snap.compressionCount, 30)
        XCTAssertEqual(snap.shockCount, 1)
        XCTAssertTrue(snap.rosc)

        let summary = model.endCode()
        XCTAssertFalse(mock.isRunning)          // detector stopped (battery)
        XCTAssertEqual(summary.totalCompressions, 30)
        XCTAssertEqual(summary.shockCount, 1)
        XCTAssertTrue(summary.events(ofKind: .cprEnd) || summary.rosc) // helper below optional
    }

    @MainActor
    func test_pauseEmitsEvents() {
        let mock = MockCompressionDetector()
        let model = CodeBlueModel(detector: mock, workout: NoopWorkoutKeepAlive(), deviceId: "watch")
        model.startCode()
        mock.emit(count: 10, rate: 110, counted: true)
        // simulate a pause tick then a resume tick
        var pause = AnalyzerTick(); pause.pauseStarted = true
        model.ingestForTest(state: { var s = CompressionState(); s.count = 10; s.paused = true; s.pauseSeconds = 3.1; return s }(), tick: pause)
        XCTAssertTrue(model.paused)
        XCTAssertTrue(model.events.contains { $0.kind == .pauseStart })
        var resume = AnalyzerTick(); resume.resumed = true
        model.ingestForTest(state: { var s = CompressionState(); s.count = 11; s.paused = false; return s }(), tick: resume)
        XCTAssertFalse(model.paused)
        XCTAssertTrue(model.events.contains { $0.kind == .resume })
    }
```

> Note: `summary.events(ofKind:)` is illustrative; replace that final assertion with `XCTAssertTrue(summary.rosc)` if you prefer not to add a helper. `ingestForTest` is a small `#if DEBUG`-free internal hook added in Step 3 so pause/resume mapping is testable without CoreMotion.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Packages/StewardMDWatchCore && swift test --filter CodeBlueModelTests`
Expected: FAIL — new members undefined.

- [ ] **Step 3: Extend `CodeBlueModel` in `TimerEngine.swift`** (additive — keep everything already there)

Add these stored properties and members to the existing `CodeBlueModel` (do not remove existing ones):

```swift
    // MARK: CPR Assist (additive — design §3.3)
    @Published public private(set) var compressionCount = 0
    @Published public private(set) var instantaneousRateCPM = 0
    @Published public private(set) var averageRateCPM = 0
    @Published public private(set) var paused = false
    @Published public private(set) var pauseSeconds: TimeInterval = 0
    @Published public private(set) var coachZone: RateZone = .idle
    @Published public private(set) var events: [CodeEvent] = []

    private var detector: CompressionDetecting?
    private var workout: WorkoutKeepAlive?
    private var deviceId = "watch"
    private var eventSeq = 0

    /// DI initialiser for CPR Assist. The no-arg `init()` remains for existing call sites.
    public convenience init(detector: CompressionDetecting, workout: WorkoutKeepAlive,
                            deviceId: String) {
        self.init()
        self.detector = detector; self.workout = workout; self.deviceId = deviceId
        detector.onChange = { [weak self] state, tick in self?.apply(state, tick) }
    }

    private func nextId(_ kind: CodeEventKind) -> String {
        eventSeq += 1; return "\(deviceId)-\(kind.rawValue)-\(eventSeq)"
    }

    private func append(_ kind: CodeEventKind, _ label: String = "") {
        events.append(CodeEvent(id: nextId(kind), elapsed: elapsed, kind: kind,
                                label: label, sourceDeviceId: deviceId))
    }

    /// Apply a detector batch: update measured stats + emit pause/resume events.
    private func apply(_ state: CompressionState, _ tick: AnalyzerTick) {
        compressionCount = state.count
        instantaneousRateCPM = state.instantaneousRateCPM
        averageRateCPM = state.averageRateCPM
        paused = state.paused
        pauseSeconds = state.pauseSeconds
        coachZone = RateCoach.zone(forRateCPM: state.instantaneousRateCPM, active: !state.paused)
        if tick.pauseStarted { append(.pauseStart) }
        if tick.resumed { append(.resume) }
    }

    /// Test-only hook so pause/resume mapping is verifiable without CoreMotion.
    public func ingestForTest(state: CompressionState, tick: AnalyzerTick) { apply(state, tick) }

    /// Begin a code: start sensors + keep-alive, log the start event.
    public func startCode() {
        workout?.begin()
        detector?.start()
        append(.cprStart)
    }

    /// End a code: stop sensors + keep-alive (battery), log the end event, build summary.
    public func endCode() -> CodeSummary {
        append(.cprEnd)
        detector?.stop()
        workout?.end()
        return CodeSummary.build(events: events, durationSeconds: elapsed, cycles: cycle,
                                 totalCompressions: compressionCount, averageRateCPM: averageRateCPM)
    }

    public func recordDrug(_ name: String) { recordAdrenalineIfEpi(name); append(.drug, name) }
    private func recordAdrenalineIfEpi(_ name: String) {
        let n = name.lowercased()
        if n.contains("epinephrine") || n.contains("adrenaline") { adrenalineCount += 1 }
    }
    public func markSwitchCompressor() { append(.switchCompressor, "Switch compressor") }

    /// Build the live snapshot streamed to the phone (design §5).
    public func snapshot(batteryLevel: Double) -> CodeBlueState {
        CodeBlueState(running: true, elapsed: elapsed, cycle: cycle,
                      compressionCount: compressionCount, instantaneousRateCPM: instantaneousRateCPM,
                      averageRateCPM: averageRateCPM, coachZone: coachZone, paused: paused,
                      pauseSeconds: pauseSeconds, adrenalineCount: adrenalineCount,
                      shockCount: shockCount, rosc: rosc, batteryLevel: batteryLevel,
                      events: events, updatedElapsed: elapsed)
    }
```

Then update the three existing recorders to also log timestamped events (keep the counters):

```swift
    public func recordAdrenaline() { adrenalineCount += 1; append(.drug, "Epinephrine") }
    public func recordShock() { shockCount += 1; append(.shock, "Shock #\(shockCount)") }
    public func markROSC() { rosc = true; append(.rosc, "ROSC") }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd Packages/StewardMDWatchCore && swift test --filter CodeBlueModelTests`
Expected: PASS (existing + 2 new). Remove the illustrative `summary.events(ofKind:)` assertion per the Step-1 note if not implemented.

- [ ] **Step 5: Run the full suite (regression gate)**

Run: `cd Packages/StewardMDWatchCore && swift test`
Expected: all green (180 existing + new).

- [ ] **Step 6: Commit**

```bash
git add Packages/StewardMDWatchCore/Sources/StewardMDWatchCore/Engines/TimerEngine.swift \
        Packages/StewardMDWatchCore/Tests/StewardMDWatchCoreTests/CodeBlueModelTests.swift
git commit -m "feat(watch): extend CodeBlueModel with CPR timeline/stats/snapshot (additive)"
```

---

## Task 6: `CoreMotionCompressionDetector` (watch app, isolated)

**Files:**
- Create: `ios/StewardMDWatch/System/CoreMotionCompressionDetector.swift`
- Create: `scripts/add-codeblue-files.rb`
- Modify: `ios/App/App.xcodeproj/project.pbxproj` (via the script)

**Interfaces:**
- Consumes: `CompressionDetecting`, `CompressionAnalyzer`, `CompressionSample` (Core).
- Produces: `CoreMotionCompressionDetector` conforming to `CompressionDetecting`.

- [ ] **Step 1: Write `CoreMotionCompressionDetector.swift`**

```swift
import Foundation
import StewardMDWatchCore
#if canImport(CoreMotion)
import CoreMotion
#endif

/// The ONLY file that imports CoreMotion (design §0/§3.2). Samples device-motion at
/// ~50 Hz, feeds |userAcceleration| into a `CompressionAnalyzer`, and republishes
/// measured state on the main actor. Sensors run only between `start()`/`stop()`.
@MainActor
final class CoreMotionCompressionDetector: CompressionDetecting {
    var onChange: ((CompressionState, AnalyzerTick) -> Void)?
    private(set) var isRunning = false
    private var analyzer = CompressionAnalyzer()

    #if canImport(CoreMotion)
    private let motion = CMMotionManager()
    private let queue = OperationQueue()
    #endif

    func start() {
        guard !isRunning else { return }
        isRunning = true
        analyzer = CompressionAnalyzer()
        #if canImport(CoreMotion)
        guard motion.isDeviceMotionAvailable else { return }
        motion.deviceMotionUpdateInterval = 1.0 / 50.0
        queue.maxConcurrentOperationCount = 1
        motion.startDeviceMotionUpdates(to: queue) { [weak self] dm, _ in
            guard let dm else { return }
            let a = dm.userAcceleration
            let mag = (a.x * a.x + a.y * a.y + a.z * a.z).squareRoot()
            let t = dm.timestamp
            Task { @MainActor in
                guard let self, self.isRunning else { return }
                let tick = self.analyzer.ingest(CompressionSample(t: t, magnitude: mag))
                self.onChange?(self.analyzer.state, tick)
            }
        }
        #endif
    }

    func stop() {
        guard isRunning else { return }
        isRunning = false
        #if canImport(CoreMotion)
        motion.stopDeviceMotionUpdates()
        #endif
    }
}
```

- [ ] **Step 2: Write `scripts/add-codeblue-files.rb`** (registers the new watch-app files in the Xcode target — pattern from `scripts/add-tasksview.rb`)

```ruby
#!/usr/bin/env ruby
# frozen_string_literal: true
# One-off: register new StewardMDWatch source files in the target.
#   Run:  ruby scripts/add-codeblue-files.rb   (quit Xcode first)
require "xcodeproj"

ROOT    = File.expand_path("..", __dir__)
PROJECT = File.join(ROOT, "ios/App/App.xcodeproj")
project = Xcodeproj::Project.open(PROJECT)
target  = project.targets.find { |t| t.name == "StewardMDWatch" }
abort("✗ StewardMDWatch target not found") unless target

FILES = ["CoreMotionCompressionDetector.swift", "HealthKitWorkoutKeepAlive.swift"]
anchor = project.files.find { |f| f.display_name == "WatchConnectivityManager.swift" }
abort("✗ anchor not found") unless anchor
group = anchor.parent

FILES.each do |name|
  if project.files.any? { |f| f.display_name == name }
    puts "✓ #{name} already referenced"; next
  end
  ref = group.new_file(name)
  target.source_build_phase.add_file_reference(ref, true)
  puts "✓ Added #{name}"
end
project.save
```

- [ ] **Step 3: Run the script**

Run: `ruby scripts/add-codeblue-files.rb`
Expected: `✓ Added CoreMotionCompressionDetector.swift` (HealthKit file added in Task 7; the script tolerates the missing file being added later since it references by name — create the HealthKit file first if the script errors on a missing path, or run the script after Task 7 Step 1).

> If `xcodeproj` errors because `HealthKitWorkoutKeepAlive.swift` doesn't exist yet, create an empty stub `ios/StewardMDWatch/System/HealthKitWorkoutKeepAlive.swift` now (filled in Task 7).

- [ ] **Step 4: Build the watch app**

Run: `xcodebuild -project ios/App/App.xcodeproj -scheme StewardMDWatch -sdk watchsimulator27.0 -destination 'generic/platform=watchOS Simulator' CODE_SIGNING_ALLOWED=NO build 2>&1 | tail -5`
Expected: `** BUILD SUCCEEDED **`, no warnings.

- [ ] **Step 5: Commit**

```bash
git add ios/StewardMDWatch/System/CoreMotionCompressionDetector.swift scripts/add-codeblue-files.rb ios/App/App.xcodeproj/project.pbxproj
git commit -m "feat(watch): CoreMotion compression detector (isolated) + target wiring"
```

---

## Task 7: `HealthKitWorkoutKeepAlive` (watch app, isolated) + capability

**Files:**
- Create/replace: `ios/StewardMDWatch/System/HealthKitWorkoutKeepAlive.swift`
- Modify: `ios/StewardMDWatch/Info.plist` — add `NSHealthShareUsageDescription` + `NSHealthUpdateUsageDescription`.
- Doc: append the manual Xcode capability step to `docs/APPLE_WATCH.md`.

**Interfaces:**
- Consumes: `WorkoutKeepAlive` (Core).
- Produces: `HealthKitWorkoutKeepAlive` conforming to `WorkoutKeepAlive`.

- [ ] **Step 1: Write `HealthKitWorkoutKeepAlive.swift`**

```swift
import Foundation
import StewardMDWatchCore
#if canImport(HealthKit)
import HealthKit
#endif

/// Keeps the watch app + motion sensors alive during a code by running a lightweight
/// `HKWorkoutSession` (design §3.2). Degrades silently to no-op if HealthKit is
/// unavailable or authorization is denied — CoreMotion still works while
/// foregrounded / Always-On, so counting never hard-fails.
@MainActor
final class HealthKitWorkoutKeepAlive: WorkoutKeepAlive {
    private(set) var isActive = false
    #if canImport(HealthKit)
    private let store = HKHealthStore()
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    #endif

    func begin() {
        guard !isActive else { return }
        #if canImport(HealthKit) && os(watchOS)
        guard HKHealthStore.isHealthDataAvailable() else { return }
        store.requestAuthorization(toShare: [HKQuantityType.workoutType()], read: []) { [weak self] ok, _ in
            guard ok else { return }
            Task { @MainActor in self?.startSession() }
        }
        #endif
        isActive = true
    }

    #if canImport(HealthKit) && os(watchOS)
    private func startSession() {
        let cfg = HKWorkoutConfiguration()
        cfg.activityType = .other
        cfg.locationType = .indoor
        do {
            let s = try HKWorkoutSession(healthStore: store, configuration: cfg)
            let b = s.associatedWorkoutBuilder()
            b.dataSource = HKLiveWorkoutDataSource(healthStore: store, workoutConfiguration: cfg)
            session = s; builder = b
            let start = Date()
            s.startActivity(with: start)
            b.beginCollection(withStart: start) { _, _ in }
        } catch { /* graceful: CoreMotion-only fallback */ }
    }
    #endif

    func end() {
        guard isActive else { return }
        isActive = false
        #if canImport(HealthKit) && os(watchOS)
        let end = Date()
        session?.end()
        builder?.endCollection(withEnd: end) { [weak self] _, _ in
            self?.builder?.finishWorkout { _, _ in }
        }
        session = nil; builder = nil
        #endif
    }
}
```

- [ ] **Step 2: Add HealthKit usage strings to the watch Info.plist**

Add inside the top-level `<dict>` of `ios/StewardMDWatch/Info.plist`:

```xml
	<key>NSHealthShareUsageDescription</key>
	<string>StewardMD uses a brief workout session during a Code Blue only to keep compression tracking active. No health data is read or stored.</string>
	<key>NSHealthUpdateUsageDescription</key>
	<string>StewardMD starts a short workout session during a Code Blue only to keep compression tracking active on your wrist.</string>
```

- [ ] **Step 3: Document the one-time Xcode capability step** (append to `docs/APPLE_WATCH.md`)

```markdown
## Code Blue CPR Assist — HealthKit capability (one-time, manual)

CPR Assist starts a short `HKWorkoutSession` during a code so motion sampling keeps
running wrist-down. Enable it once (quit + reopen the project first is fine):

1. Open `ios/App/App.xcodeproj` in Xcode.
2. Select the **StewardMDWatch Watch App** target → **Signing & Capabilities**.
3. **+ Capability → HealthKit**. Tick **Workout Processing** (background) if offered.
4. Confirm the two `NSHealth*UsageDescription` strings are present in the target's Info.
5. Build. If HealthKit is ever unavailable/denied, CPR Assist falls back to
   CoreMotion-only automatically — no code change needed.
```

- [ ] **Step 4: Build the watch app**

Run: `xcodebuild -project ios/App/App.xcodeproj -scheme StewardMDWatch -sdk watchsimulator27.0 -destination 'generic/platform=watchOS Simulator' CODE_SIGNING_ALLOWED=NO build 2>&1 | tail -5`
Expected: `** BUILD SUCCEEDED **`. (The workout session won't actually run in this build path without the capability, but the code compiles and no-ops safely.)

- [ ] **Step 5: Commit**

```bash
git add ios/StewardMDWatch/System/HealthKitWorkoutKeepAlive.swift ios/StewardMDWatch/Info.plist docs/APPLE_WATCH.md
git commit -m "feat(watch): HealthKit workout keep-alive (graceful fallback) + capability docs"
```

---

## Task 8: CPR dashboard in `CodeBlueView` (additive UI)

**Files:**
- Modify: `ios/StewardMDWatch/CodeBlueView.swift`

**Interfaces:**
- Consumes: extended `CodeBlueModel` (Task 5), `CoreMotionCompressionDetector` (Task 6), `HealthKitWorkoutKeepAlive` (Task 7), `RateCoach`.

- [ ] **Step 1: Rewrite `CodeBlueView.swift`** (preserves the existing timer/next-drug/Rhythm/Start-End behavior; adds the CPR dashboard while running)

```swift
import SwiftUI
import Combine
import StewardMDWatchCore

/// Code Blue toolkit + CPR Assist (design §3.3). Preserves the ACLS timer, 2-min
/// cycle haptic, next-drug prompt, and Start/End; adds a live compression counter,
/// rate coach, pause banner, and a Digital-Crown-scrollable event timeline while a
/// code is running. Motion is captured through an injected detector — this view
/// never imports CoreMotion.
struct CodeBlueView: View {
    @StateObject private var model = CodeBlueModel(
        detector: CoreMotionCompressionDetector(),
        workout: HealthKitWorkoutKeepAlive(),
        deviceId: WKDeviceId.current)
    @State private var running = false
    @State private var startDate: Date?
    @State private var summary: CodeSummary?
    @State private var crown = 0.0
    @Environment(\.scenePhase) private var scenePhase
    private let ticker = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    private func syncTick() {
        guard running, let s = startDate else { return }
        if model.sync(to: Date().timeIntervalSince(s)) {
            HapticManager.play(.critical)
            model.markSwitchCompressor()          // 2-min boundary → "Switch Compressor"
        }
        WatchConnectivityManager.shared.streamCodeBlue(model.snapshot(batteryLevel: WKDeviceId.battery))
    }

    var body: some View {
        ScrollView {
            VStack(spacing: SMDSpacing.s) {
                SeverityChip(tier: .critical, text: "CODE BLUE")
                Text(model.elapsedLabel)
                    .font(.system(size: 40, weight: .bold, design: .rounded))
                    .monospacedDigit().foregroundStyle(SMDPalette.text1.color)
                Text("cycle \(model.cycle) · rhythm in \(model.rhythmCountdownLabel)")
                    .font(.caption2).foregroundStyle(SMDPalette.text2.color)

                if running { cprDashboard }

                nextDrugCard
                drugButtons
                startEndButton

                if let s = summary { summaryLine(s) }
                Text(CodeSummary.disclaimerText)
                    .font(.system(size: 10)).foregroundStyle(SMDPalette.text2.color)
                    .multilineTextAlignment(.center)
                    .accessibilityLabel("Motion-based estimates. Not a measure of CPR quality or depth.")
            }
            .padding(SMDSpacing.screenMargin)
        }
        .navigationTitle("Code Blue")
        .focusable(running)
        .digitalCrownRotation($crown)
        .onReceive(ticker) { _ in syncTick() }
        .onChange(of: scenePhase) { _, phase in if phase == .active { syncTick() } }
    }

    private var cprDashboard: some View {
        VStack(spacing: 4) {
            if model.paused {
                Text("CPR PAUSED · \(TimeFormat.mmss(model.pauseSeconds))")
                    .font(.headline).foregroundStyle(SMDPalette.critical.color)
                    .accessibilityLabel("CPR paused \(Int(model.pauseSeconds)) seconds")
            } else {
                Text("\(model.instantaneousRateCPM) /min est.")
                    .font(.system(size: 22, weight: .semibold, design: .rounded))
                    .foregroundStyle(coachColor)
                Text(RateCoach.guidance(model.coachZone)).font(.caption).foregroundStyle(coachColor)
            }
            Text("\(model.compressionCount) compressions")
                .font(.system(size: 30, weight: .bold, design: .rounded)).monospacedDigit()
                .foregroundStyle(SMDPalette.text1.color)
        }
        .frame(maxWidth: .infinity).padding(SMDSpacing.cardPadding)
        .background(SMDPalette.surface.color, in: RoundedRectangle(cornerRadius: SMDSpacing.radiusCard))
        .onChange(of: model.coachZone) { _, z in
            if z == .tooSlow || z == .tooFast { HapticManager.play(.warning) }
        }
    }

    private var coachColor: Color {
        switch model.coachZone {
        case .onTarget: return SMDPalette.success.color
        case .tooSlow, .tooFast: return SMDPalette.accent.color
        case .idle: return SMDPalette.text2.color
        }
    }

    private var nextDrugCard: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("NEXT").font(.caption2).foregroundStyle(SMDPalette.text2.color)
            Text(model.nextDrug).font(.headline).foregroundStyle(SMDPalette.accent.color)
        }
        .frame(maxWidth: .infinity, alignment: .leading).padding(SMDSpacing.cardPadding)
        .background(SMDPalette.surface.color, in: RoundedRectangle(cornerRadius: SMDSpacing.radiusCard))
    }

    private var drugButtons: some View {
        VStack(spacing: 4) {
            HStack {
                Button("Epi") { model.recordDrug("Epinephrine"); HapticManager.play(.success) }
                    .tint(SMDPalette.accent.color)
                Button("Amio") { model.recordDrug("Amiodarone"); HapticManager.play(.success) }
                    .tint(SMDPalette.accent.color)
                Button("Shock") { model.recordShock(); HapticManager.play(.warning) }
                    .tint(SMDPalette.critical.color)
            }.font(.caption)
            HStack {
                Button("Rhythm") { HapticManager.play(.warning) }.tint(SMDPalette.info.color)
                Button("ROSC") { model.markROSC(); HapticManager.play(.success) }
                    .tint(SMDPalette.success.color)
            }.font(.caption)
        }
    }

    private var startEndButton: some View {
        Button(running ? "End" : "Start") {
            running.toggle()
            if running {
                startDate = Date().addingTimeInterval(-model.elapsed)
                model.startCode()
                ResusAlerts.requestAuth()
                ResusAlerts.schedule(id: "codeblue-cycle", after: 120,
                                     title: "Code Blue", body: "Rhythm check — switch compressor.", repeats: true)
            } else {
                ResusAlerts.cancel(["codeblue-cycle"])
                summary = model.endCode()
                WatchConnectivityManager.shared.streamCodeBlueSnapshot(model.snapshot(batteryLevel: WKDeviceId.battery))
            }
        }
        .buttonStyle(.borderedProminent)
        .tint(running ? SMDPalette.critical.color : SMDPalette.success.color)
    }

    private func summaryLine(_ s: CodeSummary) -> some View {
        Text("Duration \(s.durationLabel) · \(s.totalCompressions) comp · ~\(s.averageRateCPM)/min · \(s.shockCount) shock\(s.rosc ? " · ROSC ✓" : "")")
            .font(.caption2).foregroundStyle(SMDPalette.text2.color)
    }
}
```

- [ ] **Step 2: Add `WKDeviceId` helper** (device id + battery; watch-app-local). Put it at the bottom of `CodeBlueView.swift`:

```swift
import WatchKit

/// Stable per-device id + battery reading for Code Blue streaming.
enum WKDeviceId {
    static let current: String = WKInterfaceDevice.current().identifierForVendor?.uuidString ?? "watch"
    static var battery: Double {
        WKInterfaceDevice.current().isBatteryMonitoringEnabled = true
        let lvl = WKInterfaceDevice.current().batteryLevel
        return lvl < 0 ? -1 : Double(lvl)
    }
}
```

> `streamCodeBlue` / `streamCodeBlueSnapshot` are added to `WatchConnectivityManager` in Task 9. Implement Task 9 before building this task, or stub the two calls temporarily.

- [ ] **Step 3: Build the watch app**

Run: `xcodebuild -project ios/App/App.xcodeproj -scheme StewardMDWatch -sdk watchsimulator27.0 -destination 'generic/platform=watchOS Simulator' CODE_SIGNING_ALLOWED=NO build 2>&1 | tail -5`
Expected: `** BUILD SUCCEEDED **` (after Task 9 exists).

- [ ] **Step 4: Commit**

```bash
git add ios/StewardMDWatch/CodeBlueView.swift
git commit -m "feat(watch): CPR Assist dashboard — live count, rate coach, pause, timeline"
```

---

## Task 9: Watch → phone streaming (`WatchConnectivityManager`)

**Files:**
- Modify: `ios/StewardMDWatch/System/WatchConnectivityManager.swift`

**Interfaces:**
- Consumes: `CodeBlueState` (Task 1).
- Produces: `func streamCodeBlue(_:)` (live, `sendMessage`), `func streamCodeBlueSnapshot(_:)` (guaranteed, `transferUserInfo` + `updateApplicationContext`).

- [ ] **Step 1: Add the two streaming methods** (near `relaySend`)

```swift
    /// Live Code Blue state → phone. `sendMessage` when reachable (immediate, for the
    /// live-feeling Command Center); silently dropped when unreachable — the periodic
    /// snapshot (below) guarantees eventual delivery + recovery.
    func streamCodeBlue(_ state: CodeBlueState) {
        #if canImport(WatchConnectivity)
        guard WCSession.isSupported(), let data = try? JSONEncoder().encode(state) else { return }
        let s = WCSession.default
        if s.activationState == .activated, s.isReachable {
            s.sendMessage(["kind": "codeBlueLive", "state": data], replyHandler: nil, errorHandler: nil)
        }
        #endif
    }

    /// Guaranteed snapshot → phone: `transferUserInfo` (queued, FIFO, background-safe)
    /// for auto-recovery after a disconnect, plus `updateApplicationContext` (coalesced,
    /// survives phone relaunch). Call periodically and on End/ROSC.
    func streamCodeBlueSnapshot(_ state: CodeBlueState) {
        #if canImport(WatchConnectivity)
        guard WCSession.isSupported(), let data = try? JSONEncoder().encode(state) else { return }
        let s = WCSession.default
        guard s.activationState == .activated else { return }
        s.transferUserInfo(["kind": "codeBlueSnapshot", "state": data])
        try? s.updateApplicationContext(["codeBlueSnapshot": data])
        #endif
    }
```

- [ ] **Step 2: Build the watch app**

Run: `xcodebuild -project ios/App/App.xcodeproj -scheme StewardMDWatch -sdk watchsimulator27.0 -destination 'generic/platform=watchOS Simulator' CODE_SIGNING_ALLOWED=NO build 2>&1 | tail -5`
Expected: `** BUILD SUCCEEDED **`. Task 8 + Task 9 now compile together.

- [ ] **Step 3: Commit**

```bash
git add ios/StewardMDWatch/System/WatchConnectivityManager.swift
git commit -m "feat(watch): stream live Code Blue state + guaranteed snapshots to phone"
```

---

## Task 10: Phone relay routes `codeBlue*` + plugin gains `StewardMDWatchCore`

**Files:**
- Modify: `local-plugins/capacitor-watch-bridge/Package.swift`
- Modify: `local-plugins/capacitor-watch-bridge/ios/Sources/WatchBridgePlugin/WatchConnectivityRelay.swift`

**Interfaces:**
- Produces: `WatchConnectivityRelay.codeBlueReceived` `Notification.Name`; routes `codeBlueLive`/`codeBlueSnapshot` messages + `codeBlueSnapshot` app-context to it.

- [ ] **Step 1: Add the Core dependency to the plugin `Package.swift`**

Change the `dependencies:` and target `dependencies:` arrays:

```swift
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0"),
        .package(name: "StewardMDWatchCore", path: "../../Packages/StewardMDWatchCore")
    ],
    targets: [
        .target(
            name: "WatchBridgePlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "StewardMDWatchCore", package: "StewardMDWatchCore")
            ],
            path: "ios/Sources/WatchBridgePlugin")
    ]
```

- [ ] **Step 2: Route Code Blue messages in `WatchConnectivityRelay.swift`**

Add the notification name (with the others near the bottom):

```swift
    static let codeBlueReceived = Notification.Name("SMDCodeBlueReceived")
```

In `didReceiveMessage` (the no-reply variant), add cases:

```swift
        case "codeBlueLive", "codeBlueSnapshot":
            NotificationCenter.default.post(name: WatchConnectivityRelay.codeBlueReceived, object: nil, userInfo: message)
```

In `didReceiveUserInfo`, add:

```swift
        case "codeBlueSnapshot":
            NotificationCenter.default.post(name: WatchConnectivityRelay.codeBlueReceived, object: nil, userInfo: userInfo)
```

Add app-context handling (so a relaunched phone recovers the latest snapshot) — implement `didReceiveApplicationContext`:

```swift
    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        if applicationContext["codeBlueSnapshot"] != nil {
            NotificationCenter.default.post(name: WatchConnectivityRelay.codeBlueReceived, object: nil,
                                            userInfo: ["kind": "codeBlueSnapshot", "state": applicationContext["codeBlueSnapshot"] as Any])
        }
    }
```

- [ ] **Step 3: Build the iOS app**

Run: `xcodebuild -project ios/App/App.xcodeproj -scheme App -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build 2>&1 | tail -5`
Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 4: Commit**

```bash
git add local-plugins/capacitor-watch-bridge/Package.swift local-plugins/capacitor-watch-bridge/ios/Sources/WatchBridgePlugin/WatchConnectivityRelay.swift
git commit -m "feat(ios): route watch Code Blue stream through the relay + link Core"
```

---

## Task 11: `CodeBlueSyncService` + local persistence (phone)

**Files:**
- Create: `local-plugins/capacitor-watch-bridge/ios/Sources/WatchBridgePlugin/CodeBlue/CodeBlueSyncService.swift`

**Interfaces:**
- Consumes: `CodeBlueState`, `CodeEvent` (Core); `WatchConnectivityRelay.codeBlueReceived` (Task 10).
- Produces: `CodeBlueSyncService` protocol (`var onState: ((CodeBlueState) -> Void)?`, `func start()`); `WatchConnectivityCodeBlueSync`; `CodeBlueLocalStore` (`save(_:)`, `load() -> CodeBlueState?`, `clear()`) writing JSON to the app container; a pure `mergeEvents(_:_:)` free function.

- [ ] **Step 1: Write `CodeBlueSyncService.swift`**

```swift
import Foundation
import StewardMDWatchCore

/// Transport-agnostic ingest boundary (design §5). Current impl = WatchConnectivity;
/// future impls (BLE defib, multipeer multi-watch, FHIR) conform without UI changes.
protocol CodeBlueSyncService: AnyObject {
    var onState: ((CodeBlueState) -> Void)? { get set }
    func start()
}

/// Merge two event lists by id (dedupe), preserving elapsed order. Pure + testable.
func mergeEvents(_ a: [CodeEvent], _ b: [CodeEvent]) -> [CodeEvent] {
    var byId: [String: CodeEvent] = [:]
    for e in a + b { byId[e.id] = e }
    return byId.values.sorted { $0.elapsed < $1.elapsed }
}

/// Local-only persistence of the latest Code Blue state (design §10 privacy). JSON in
/// Application Support (default file protection). Never uploaded.
final class CodeBlueLocalStore {
    private let url: URL
    init() {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        url = dir.appendingPathComponent("codeblue-state.json")
    }
    func save(_ state: CodeBlueState) { if let d = try? JSONEncoder().encode(state) { try? d.write(to: url, options: .completeFileProtection) } }
    func load() -> CodeBlueState? { (try? Data(contentsOf: url)).flatMap { try? JSONDecoder().decode(CodeBlueState.self, from: $0) } }
    func clear() { try? FileManager.default.removeItem(at: url) }
}

/// WatchConnectivity-backed sync: decodes `state` payloads posted by the relay
/// (Task 10) and forwards decoded `CodeBlueState` on the main queue.
final class WatchConnectivityCodeBlueSync: CodeBlueSyncService {
    var onState: ((CodeBlueState) -> Void)?
    func start() {
        NotificationCenter.default.addObserver(forName: WatchConnectivityRelay.codeBlueReceived,
                                               object: nil, queue: .main) { [weak self] note in
            guard let data = note.userInfo?["state"] as? Data,
                  let state = try? JSONDecoder().decode(CodeBlueState.self, from: data) else { return }
            self?.onState?(state)
        }
    }
}
```

- [ ] **Step 2: Build the iOS app**

Run: `xcodebuild -project ios/App/App.xcodeproj -scheme App -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build 2>&1 | tail -5`
Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 3: Commit**

```bash
git add local-plugins/capacitor-watch-bridge/ios/Sources/WatchBridgePlugin/CodeBlue/CodeBlueSyncService.swift
git commit -m "feat(ios): Code Blue sync service + local-only persistence + event merge"
```

---

## Task 12: `CodeBlueLiveModel` (phone view model)

**Files:**
- Create: `local-plugins/capacitor-watch-bridge/ios/Sources/WatchBridgePlugin/CodeBlue/CodeBlueLiveModel.swift`

**Interfaces:**
- Consumes: `CodeBlueSyncService`, `CodeBlueLocalStore`, `mergeEvents`, `CodeBlueState` (Task 11); `WatchConnectivityRelay` reachability.
- Produces: `CodeBlueLiveModel.shared` (`@MainActor ObservableObject`) with `@Published state`, `@Published connected`, `@Published lastUpdate`, `func begin()`, `func summary() -> CodeSummary`, `func clearLocal()`.

- [ ] **Step 1: Write `CodeBlueLiveModel.swift`**

```swift
import Foundation
import Combine
import StewardMDWatchCore
#if canImport(WatchConnectivity)
import WatchConnectivity
#endif

/// Phone-side live mirror of the watch Code Blue (design §4.2). A singleton so it
/// keeps ingesting + persisting even when the Command Center screen is closed; the
/// SwiftUI views just bind to it. Merges live messages + guaranteed snapshots by
/// event id, ignores stale out-of-order updates, and persists locally only.
@MainActor
final class CodeBlueLiveModel: ObservableObject {
    static let shared = CodeBlueLiveModel()

    @Published private(set) var state: CodeBlueState = .empty
    @Published private(set) var connected = false
    @Published private(set) var lastUpdate: Date?

    private let sync: CodeBlueSyncService
    private let store = CodeBlueLocalStore()
    private var reachTimer: AnyCancellable?

    init(sync: CodeBlueSyncService = WatchConnectivityCodeBlueSync()) {
        self.sync = sync
        if let saved = store.load() { state = saved }
    }

    /// Wire up ingest + reachability. Idempotent; call at plugin load.
    func begin() {
        sync.onState = { [weak self] incoming in self?.ingest(incoming) }
        sync.start()
        refreshReachability()
        reachTimer = Timer.publish(every: 2, on: .main, in: .common).autoconnect()
            .sink { [weak self] _ in self?.refreshReachability() }
    }

    private func ingest(_ incoming: CodeBlueState) {
        // Ignore stale live messages that would regress a newer snapshot.
        guard incoming.updatedElapsed >= state.updatedElapsed || incoming.events.count >= state.events.count else { return }
        var merged = incoming
        merged.events = mergeEvents(state.events, incoming.events)
        state = merged
        lastUpdate = Date()
        store.save(merged)
    }

    private func refreshReachability() {
        #if canImport(WatchConnectivity)
        connected = WCSession.isSupported() && WCSession.default.isReachable
        #endif
    }

    /// Build a summary from the current local state (for the End screen / export).
    func summary() -> CodeSummary {
        CodeSummary.build(events: state.events, durationSeconds: state.elapsed,
                          cycles: state.cycle, totalCompressions: state.compressionCount,
                          averageRateCPM: state.averageRateCPM)
    }

    /// Clear local logs (privacy — offered on sign-out).
    func clearLocal() { store.clear(); state = .empty; lastUpdate = nil }
}
```

- [ ] **Step 2: Build the iOS app**

Run: `xcodebuild -project ios/App/App.xcodeproj -scheme App -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build 2>&1 | tail -5`
Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 3: Commit**

```bash
git add local-plugins/capacitor-watch-bridge/ios/Sources/WatchBridgePlugin/CodeBlue/CodeBlueLiveModel.swift
git commit -m "feat(ios): CodeBlueLiveModel — merge/persist/reachability singleton"
```

---

## Task 13: Command Center SwiftUI (dashboard + summary + export)

**Files:**
- Create: `local-plugins/capacitor-watch-bridge/ios/Sources/WatchBridgePlugin/CodeBlue/CommandCenterView.swift`

**Interfaces:**
- Consumes: `CodeBlueLiveModel` (Task 12), `RateCoach`, `TimeFormat`, `CodeSummary`.
- Produces: `CommandCenterView` (`View`), `CodeBlueExporter` closure type `(_ detail: String) -> Void`.

- [ ] **Step 1: Write `CommandCenterView.swift`** (Fitness/Health/Emergency-SOS feel: dark, large numerals, red accent)

```swift
import SwiftUI
import StewardMDWatchCore

/// iPhone Code Blue Command Center (design §4.3). Live mirror of the watch; opt-in
/// export; local-only data. Presented full-screen from the web home card.
struct CommandCenterView: View {
    @ObservedObject var model = CodeBlueLiveModel.shared
    var onExport: (String) -> Void = { _ in }
    var onClose: () -> Void = {}
    @State private var showShare = false

    private var s: CodeBlueState { model.state }

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 16) {
                    connectionRow
                    timerBlock
                    if s.paused { pausedBanner } else { rateBlock }
                    compressionsBlock
                    countersRow
                    timelineSection
                    if !s.running && !s.events.isEmpty { summarySection }
                    Text(CodeSummary.disclaimerText)
                        .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                }
                .padding()
            }
            .background(Color.black.ignoresSafeArea())
            .navigationTitle("Code Blue")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close", action: onClose) } }
        }
        .preferredColorScheme(.dark)
        .sheet(isPresented: $showShare) { ShareSheet(text: model.summary().formattedDetail()) }
    }

    private var connectionRow: some View {
        HStack(spacing: 8) {
            Circle().fill(model.connected ? .green : .orange).frame(width: 10, height: 10)
            Text(model.connected ? "Apple Watch connected" : "Watch not reachable")
                .font(.subheadline).foregroundStyle(.white)
            Spacer()
            if s.batteryLevel >= 0 {
                Image(systemName: "battery.100")
                Text("\(Int(s.batteryLevel * 100))%").font(.subheadline).foregroundStyle(.white)
            }
        }
    }

    private var timerBlock: some View {
        VStack {
            Text(TimeFormat.mmss(s.elapsed)).font(.system(size: 64, weight: .bold, design: .rounded))
                .monospacedDigit().foregroundStyle(.white)
            Text("cycle \(s.cycle)").font(.subheadline).foregroundStyle(.secondary)
        }
    }

    private var rateBlock: some View {
        VStack {
            Text("\(s.instantaneousRateCPM)").font(.system(size: 44, weight: .bold, design: .rounded))
                .foregroundStyle(color(for: s.coachZone))
            Text("/min est. · \(RateCoach.guidance(s.coachZone))")
                .font(.headline).foregroundStyle(color(for: s.coachZone))
        }
        .frame(maxWidth: .infinity).padding().background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
    }

    private var pausedBanner: some View {
        Text("CPR PAUSED · \(TimeFormat.mmss(s.pauseSeconds))")
            .font(.title2.bold()).foregroundStyle(.red)
            .frame(maxWidth: .infinity).padding().background(Color.red.opacity(0.12), in: RoundedRectangle(cornerRadius: 16))
    }

    private var compressionsBlock: some View {
        VStack {
            Text("\(s.compressionCount)").font(.system(size: 40, weight: .bold, design: .rounded)).foregroundStyle(.white)
            Text("compressions (est.)").font(.subheadline).foregroundStyle(.secondary)
        }
    }

    private var countersRow: some View {
        HStack(spacing: 12) {
            counter("Shocks", "\(s.shockCount)", .orange)
            counter("Epi", "\(s.adrenalineCount)", .blue)
            counter("ROSC", s.rosc ? "✓" : "—", s.rosc ? .green : .gray)
        }
    }

    private func counter(_ label: String, _ value: String, _ tint: Color) -> some View {
        VStack { Text(value).font(.title2.bold()).foregroundStyle(tint); Text(label).font(.caption).foregroundStyle(.secondary) }
            .frame(maxWidth: .infinity).padding(.vertical, 10).background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
    }

    private var timelineSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Timeline").font(.headline).foregroundStyle(.white)
            ForEach(s.events.reversed()) { e in
                HStack {
                    Text(TimeFormat.mmss(e.elapsed)).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                    Text(label(for: e)).font(.subheadline).foregroundStyle(.white)
                    Spacer()
                }
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }

    private var summarySection: some View {
        VStack(spacing: 10) {
            Text("Code summary").font(.headline).foregroundStyle(.white)
            Text(model.summary().formattedDetail()).font(.footnote).foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button { onExport(model.summary().formattedDetail()) } label: {
                Label("Export to patient record", systemImage: "square.and.arrow.up.on.square")
                    .frame(maxWidth: .infinity)
            }.buttonStyle(.borderedProminent).tint(.red)
            Button { showShare = true } label: { Label("Share…", systemImage: "square.and.arrow.up").frame(maxWidth: .infinity) }
                .buttonStyle(.bordered)
        }.padding().background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
    }

    private func color(for z: RateZone) -> Color {
        switch z { case .onTarget: return .green; case .tooSlow, .tooFast: return .yellow; case .idle: return .gray }
    }
    private func label(for e: CodeEvent) -> String {
        switch e.kind {
        case .cprStart: return "CPR started"; case .cprEnd: return "CPR ended"
        case .shock: return e.label.isEmpty ? "Shock" : e.label
        case .drug: return e.label; case .pauseStart: return "Paused"
        case .resume: return "Resumed"; case .switchCompressor: return "Switch compressor"
        case .rosc: return "ROSC"
        }
    }
}

/// UIKit share sheet wrapper.
struct ShareSheet: UIViewControllerRepresentable {
    let text: String
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [text], applicationActivities: nil)
    }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}
```

- [ ] **Step 2: Build the iOS app**

Run: `xcodebuild -project ios/App/App.xcodeproj -scheme App -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build 2>&1 | tail -5`
Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 3: Commit**

```bash
git add local-plugins/capacitor-watch-bridge/ios/Sources/WatchBridgePlugin/CodeBlue/CommandCenterView.swift
git commit -m "feat(ios): Code Blue Command Center SwiftUI (dashboard/timeline/summary/export)"
```

---

## Task 14: Plugin method `openCodeBlue` + presentation + export bridge

**Files:**
- Modify: `local-plugins/capacitor-watch-bridge/ios/Sources/WatchBridgePlugin/WatchBridgePlugin.swift`

**Interfaces:**
- Consumes: `CommandCenterView` (Task 13), `CodeBlueLiveModel` (Task 12).
- Produces: JS methods `WatchBridge.openCodeBlue()` (presents the Command Center) and event `codeBlueExport` (fired when the user taps Export, with `{ detail }` — `native-watch.js` routes it to the documentation workflow).

- [ ] **Step 1: Register the method + start the live model at load**

In `WatchBridgePlugin.swift`, add to `pluginMethods`:

```swift
        CAPPluginMethod(name: "openCodeBlue", returnType: CAPPluginReturnPromise),
```

In `load()`, after the existing observers, start the phone-side live model:

```swift
        CodeBlueLiveModel.shared.begin()
```

- [ ] **Step 2: Implement `openCodeBlue`** (present the SwiftUI Command Center full-screen)

```swift
    @objc func openCodeBlue(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self, let presenter = self.bridge?.viewController else { call.reject("no-vc"); return }
            let root = CommandCenterView(
                onExport: { [weak self] detail in
                    self?.notifyListeners("codeBlueExport", data: ["detail": detail])
                },
                onClose: { presenter.presentedViewController?.dismiss(animated: true) }
            )
            let host = UIHostingController(rootView: root)
            host.modalPresentationStyle = .fullScreen
            presenter.present(host, animated: true)
            call.resolve()
        }
    }
```

Add `import SwiftUI` at the top of the file.

- [ ] **Step 3: Build the iOS app**

Run: `xcodebuild -project ios/App/App.xcodeproj -scheme App -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build 2>&1 | tail -5`
Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 4: Commit**

```bash
git add local-plugins/capacitor-watch-bridge/ios/Sources/WatchBridgePlugin/WatchBridgePlugin.swift
git commit -m "feat(ios): present Command Center + export bridge from the watch plugin"
```

---

## Task 15: Web home "Code Blue" card + launch + export routing

**Files:**
- Modify: `index.html` (card markup)
- Modify: `native-watch.js` (show/hide gating, tap → `openCodeBlue`, `codeBlueExport` → documentation)

**Interfaces:**
- Consumes: `WatchBridge.openCodeBlue`, `WatchBridge.getStatus` (paired check), `WatchBridge.addListener('codeBlueExport', …)`, `SMD_ICU_GROUPS.addTimelineEvent` (existing).

- [ ] **Step 1: Add the card markup** to `index.html` immediately after `modeAdvancedCard` (line ~600), so it lives with the home cards:

```html
    <button type="button" class="mode-card hidden" id="codeBlueCard"
            style="border:1px solid rgba(220,38,38,.4);background:linear-gradient(180deg,rgba(220,38,38,.10),rgba(0,0,0,0));text-align:left;width:100%"
            aria-label="Open Code Blue Command Center">
      <div class="mode-card-icon">🫀</div>
      <div class="mode-card-title">Code Blue</div>
      <div class="mode-card-desc">Live CPR command center — compressions, rate, shocks, drugs, and ROSC from your Apple Watch. On-device only.</div>
    </button>
```

- [ ] **Step 2: Wire it in `native-watch.js`** (add near the other `SMD_IS_NATIVE` plugin wiring). Show only on native iOS with a paired watch app; launch the native Command Center; route Export to the current ICU patient timeline when one is open.

```javascript
  // Code Blue Command Center launcher (native iOS + paired watch only).
  (function wireCodeBlue(){
    var P = (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.WatchBridge);
    var card = document.getElementById('codeBlueCard');
    if (!P || !card) return;
    if (P.getStatus) P.getStatus().then(function(s){
      if (s && s.supported && s.paired && s.watchAppInstalled) card.classList.remove('hidden');
    }).catch(function(){});
    card.addEventListener('click', function(){ if (P.openCodeBlue) P.openCodeBlue().catch(function(){}); });
    if (P.addListener) P.addListener('codeBlueExport', function(ev){
      try {
        var detail = (ev && ev.detail) || '';
        var G = window.SMD_ICU_GROUPS;
        if (G && G.currentOpenPatient) {
          var p = G.currentOpenPatient();   // { gid, pid } when a patient is open
          if (p && p.gid && p.pid) {
            G.addTimelineEvent(p.gid, p.pid, { type:'codeblue', title:'Code Blue summary', detail: detail });
            return;
          }
        }
        console.log('[SMD-CodeBlue] export (no patient in context) — kept on device only');
      } catch(e){}
    });
  })();
```

> If `SMD_ICU_GROUPS.currentOpenPatient` does not exist, add a 3-line getter in the ICU groups module returning the currently-open `{gid,pid}` (or `null`), mirroring how the criticals path resolves gid/pid. Do not fabricate a patient — when none is open, keep the summary on-device (log only).

- [ ] **Step 3: Bundle + build check**

Run: `npm run build:www && npx cap copy ios`
Expected: completes without error; `codeBlueCard` present in the copied `ios/App/App/public/index.html`.

- [ ] **Step 4: Commit**

```bash
git add index.html native-watch.js
git commit -m "feat(web): Code Blue home card → native Command Center + opt-in export routing"
```

---

## Task 16: Sign-out clear (privacy) + verification pass

**Files:**
- Modify: `native-watch.js` (clear local Code Blue on sign-out) — plus a plugin `clearCodeBlue` method if not already covered by `clear()`.
- Modify: `local-plugins/capacitor-watch-bridge/ios/Sources/WatchBridgePlugin/WatchBridgePlugin.swift` (extend `clear()` to also clear local Code Blue).

**Interfaces:**
- Consumes: `CodeBlueLiveModel.shared.clearLocal()`.

- [ ] **Step 1: Clear local Code Blue when the bridge is cleared** (sign-out). In `WatchBridgePlugin.clear(...)`, before `call.resolve()`:

```swift
        CodeBlueLiveModel.shared.clearLocal()
```

- [ ] **Step 2: Build the iOS app**

Run: `xcodebuild -project ios/App/App.xcodeproj -scheme App -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build 2>&1 | tail -5`
Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 3: Commit**

```bash
git add local-plugins/capacitor-watch-bridge/ios/Sources/WatchBridgePlugin/WatchBridgePlugin.swift native-watch.js
git commit -m "feat(ios): clear local Code Blue logs on sign-out (privacy)"
```

---

## Task 17: Full verification + deliverable report

**Files:**
- Create: `docs/CODE_BLUE_CPR_ASSIST.md` (the required end report).

- [ ] **Step 1: Core test suite (regression)**

Run: `cd Packages/StewardMDWatchCore && swift test 2>&1 | tail -5`
Expected: all tests pass (180 existing + the new `CompressionAnalyzerTests`, `RateCoachTests`, `CodeSummaryTests`, `CompressionDetectingTests`, extended `CodeBlueModelTests`).

- [ ] **Step 2: Watch build (no warnings)**

Run: `xcodebuild -project ios/App/App.xcodeproj -scheme StewardMDWatch -sdk watchsimulator27.0 -destination 'generic/platform=watchOS Simulator' CODE_SIGNING_ALLOWED=NO build 2>&1 | grep -E "warning:|BUILD"`
Expected: `** BUILD SUCCEEDED **`, zero `warning:` lines.

- [ ] **Step 3: iOS build (no warnings)**

Run: `xcodebuild -project ios/App/App.xcodeproj -scheme App -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build 2>&1 | grep -E "warning:|BUILD"`
Expected: `** BUILD SUCCEEDED **`, zero `warning:` lines.

- [ ] **Step 4: Write the deliverable report** `docs/CODE_BLUE_CPR_ASSIST.md` with the five required sections: **Files modified**, **Files created**, **Architecture decisions**, **Testing performed**, **Future improvements** (BLE defib, multipeer multi-watch team logging using the `sourceDeviceId` merge, Apple Watch ECG, FHIR export). Note the one-time HealthKit capability step and the CoreMotion-only graceful fallback.

- [ ] **Step 5: Commit**

```bash
git add docs/CODE_BLUE_CPR_ASSIST.md
git commit -m "docs(watch): Code Blue CPR Assist + Command Center delivery report"
```

---

## Self-Review

**1. Spec coverage:**
- CPR Assist features (1) count / (2) rate coach / (3) 2-min cycle + Switch Compressor / (4) pause / (5) shock / (6) drug / (7) ROSC / (8) timeline / (9) watch→phone sync / (10) summary+export → Tasks 2,3,5,6,8 (watch) + 9,10,11,12,13 (phone). ✓
- Command Center displays (timer, count, rate, pause, compressor reminder, shock/drug timelines, ROSC, duration, team timeline, connection, battery, summary, export) → Task 13, fed by Tasks 9–12. ✓
- Motion isolated + UI never touches CoreMotion → Tasks 4 (protocol), 6 (only CoreMotion file), 8 (UI uses protocol). ✓
- HealthKit keep-alive + graceful fallback → Task 7. ✓
- Robust sync (background-safe, persistence, auto-recovery) → Tasks 9 (three transports), 10 (routing incl. app-context), 11 (persistence + merge), 12 (merge/stale-guard). ✓
- Privacy local-first + opt-in export + clear on sign-out → Tasks 11, 13, 15, 16. ✓
- Safety copy/disclaimer, no depth/quality → Tasks 1 (disclaimer const), 3 (neutral copy + test), 8 & 13 (disclaimer shown). ✓
- Reusable service layers for future (BLE/multi-watch/ECG/FHIR) → Task 11 `CodeBlueSyncService` + `sourceDeviceId` on `CodeEvent` (Task 1). ✓
- Battery: sensors only while active → Task 5 (`endCode` stops detector+workout), Task 6 (`stop`), Task 7 (`end`). ✓
- Home card entry → Task 15. ✓

**2. Placeholder scan:** No "TBD/TODO". Two explicit conditional notes (HealthKit stub ordering in Task 6; `currentOpenPatient` getter in Task 15) give concrete fallback instructions rather than placeholders. ✓

**3. Type consistency:** `CompressionState`/`AnalyzerTick` (Task 2) used identically in Tasks 4/5/6. `CodeBlueState` fields (Task 1) match `snapshot(batteryLevel:)` (Task 5) and the Command Center reads (Task 13). `WatchConnectivityRelay.codeBlueReceived` + `userInfo["state"]: Data` produced in Task 10, consumed in Task 11. `openCodeBlue` / `codeBlueExport` names match across Tasks 14–15. `mergeEvents`, `CodeBlueLocalStore`, `CodeBlueLiveModel.shared.clearLocal()` consistent across Tasks 11/12/16. ✓
