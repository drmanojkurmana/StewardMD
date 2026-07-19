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

    private var timer = CodeBlueTimer()

    public init() {}

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

    public func recordAdrenaline() { adrenalineCount += 1 }
    public func recordShock() { shockCount += 1 }
    public func markROSC() { rosc = true }

    public func end() -> CodeBlueSummary {
        CodeBlueSummary(durationLabel: TimeFormat.mmss(elapsed), cycles: cycle,
                        adrenalineCount: adrenalineCount, shockCount: shockCount, rosc: rosc)
    }
}
