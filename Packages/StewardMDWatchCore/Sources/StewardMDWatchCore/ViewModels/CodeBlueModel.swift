import Foundation
import Combine

/// End-of-arrest summary saved to the chart (design §07 Flow B).
public struct CodeBlueSummary: Equatable, Sendable {
    public let durationLabel: String
    public let cycles: Int
    public let adrenalineCount: Int
    public let shockCount: Int
    public let rosc: Bool
}

/// Drives the Code Blue toolkit (design §06/§07): ACLS timer with 2-minute cycle
/// haptics, an adrenaline schedule (every other cycle ≈ 3–5 min), and manual
/// drug/shock tally. Wraps the pure `CodeBlueTimer`; advanced by `tick(_:)` from
/// the watch's timer so it is deterministic and testable.
@MainActor
public final class CodeBlueModel: ObservableObject {
    @Published public private(set) var elapsed: TimeInterval = 0
    @Published public private(set) var adrenalineCount = 0
    @Published public private(set) var shockCount = 0
    @Published public private(set) var rosc = false

    // MARK: CPR Assist (additive — design §3.3)
    @Published public private(set) var compressionCount = 0
    @Published public private(set) var instantaneousRateCPM = 0
    @Published public private(set) var averageRateCPM = 0
    @Published public private(set) var paused = false
    @Published public private(set) var pauseSeconds: TimeInterval = 0
    @Published public private(set) var coachZone: RateZone = .idle
    @Published public private(set) var events: [CodeEvent] = []
    @Published public private(set) var isRunning = false

    private var timer = CodeBlueTimer()
    private var detector: CompressionDetecting?
    private var workout: WorkoutKeepAlive?
    private var deviceId = "watch"
    private var eventSeq = 0

    public init() {}

    /// DI initialiser for CPR Assist. The no-arg `init()` remains for existing call sites.
    public convenience init(detector: CompressionDetecting, workout: WorkoutKeepAlive,
                            deviceId: String) {
        self.init()
        self.detector = detector; self.workout = workout; self.deviceId = deviceId
        detector.onChange = { [weak self] state, tick in self?.apply(state, tick) }
    }

    public var cycle: Int { timer.cycle }
    public var elapsedLabel: String { TimeFormat.mmss(elapsed) }
    public var rhythmCountdownLabel: String { TimeFormat.mmss(timer.secondsToNextRhythmCheck) }

    /// Next drug prompt: adrenaline on odd cycles (~every 3–5 min); otherwise the
    /// shockable-rhythm antiarrhythmic reminder.
    public var nextDrug: String {
        cycle % 2 == 1 ? "Adrenaline 1 mg" : "Amiodarone 300 mg (if shockable)"
    }

    /// Advances the clock; returns true when a 2-minute rhythm-check boundary is
    /// crossed (caller fires the cycle haptic).
    @discardableResult
    public func tick(_ dt: TimeInterval) -> Bool {
        let crossed = timer.tick(dt)
        elapsed = timer.elapsed
        return crossed
    }

    /// Sets elapsed from a wall-clock reading (AOD/background-safe). Returns true
    /// if a rhythm-check boundary was crossed since the last value, so the caller
    /// still fires the cycle haptic even when the wrist was down across it.
    @discardableResult
    public func sync(to seconds: TimeInterval) -> Bool {
        let crossed = timer.set(seconds)
        elapsed = timer.elapsed
        return crossed
    }

    public func recordAdrenaline() { adrenalineCount += 1; append(.drug, "Epinephrine") }
    public func recordShock() { shockCount += 1; append(.shock, "Shock #\(shockCount)") }
    public func markROSC() { rosc = true; append(.rosc, "ROSC") }

    public func end() -> CodeBlueSummary {
        CodeBlueSummary(durationLabel: TimeFormat.mmss(elapsed), cycles: cycle,
                        adrenalineCount: adrenalineCount, shockCount: shockCount, rosc: rosc)
    }

    // MARK: CPR Assist (additive — design §3.3)

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
        isRunning = true
        workout?.begin()
        detector?.start()
        append(.cprStart)
    }

    /// End a code: stop sensors + keep-alive (battery), log the end event, build summary.
    public func endCode() -> CodeSummary {
        append(.cprEnd)
        isRunning = false
        detector?.stop()
        workout?.end()
        return CodeSummary.build(events: events, durationSeconds: elapsed, cycles: cycle,
                                 totalCompressions: compressionCount, averageRateCPM: averageRateCPM)
    }

    public func recordDrug(_ name: String) {
        let n = name.lowercased()
        if n.contains("epinephrine") || n.contains("adrenaline") { adrenalineCount += 1 }
        append(.drug, name)
    }

    public func markSwitchCompressor() { append(.switchCompressor, "Switch compressor") }

    /// Build the live snapshot streamed to the phone (design §5).
    public func snapshot(batteryLevel: Double) -> CodeBlueState {
        CodeBlueState(running: isRunning, elapsed: elapsed, cycle: cycle,
                      compressionCount: compressionCount, instantaneousRateCPM: instantaneousRateCPM,
                      averageRateCPM: averageRateCPM, coachZone: coachZone, paused: paused,
                      pauseSeconds: pauseSeconds, adrenalineCount: adrenalineCount,
                      shockCount: shockCount, rosc: rosc, batteryLevel: batteryLevel,
                      events: events, updatedElapsed: elapsed)
    }
}
