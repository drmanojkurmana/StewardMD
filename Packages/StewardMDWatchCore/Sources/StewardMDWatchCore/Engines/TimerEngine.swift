import Foundation

/// ACLS / Code Blue timer (design §06). Counts elapsed time, marks 2-minute
/// rhythm-check cycles, and reports the countdown to the next check. Fully
/// local — never depends on the network. Advanced by `tick(_:)` from the
/// watch's display-link / timer so it is deterministic and unit-testable.
public struct CodeBlueTimer: Sendable {
    public static let cycleSeconds: TimeInterval = 120

    public private(set) var elapsed: TimeInterval = 0
    /// Rhythm-check cycle length, set from the code mode (adult/paediatric
    /// 120 s, neonatal 60 s). Defaults to 120 s so existing uses are unchanged.
    public var cycleLength: TimeInterval = CodeBlueTimer.cycleSeconds
    public init() {}

    /// 1-based cycle number.
    public var cycle: Int { Int(elapsed / cycleLength) + 1 }

    /// Seconds until the next rhythm check.
    public var secondsToNextRhythmCheck: TimeInterval {
        let r = elapsed.truncatingRemainder(dividingBy: cycleLength)
        return r == 0 ? cycleLength : cycleLength - r
    }

    /// Advances the clock. Returns `true` if a rhythm-check boundary was crossed
    /// during this tick (the caller fires the cycle haptic).
    @discardableResult
    public mutating func tick(_ dt: TimeInterval) -> Bool {
        let before = Int(elapsed / cycleLength)
        elapsed += dt
        return Int(elapsed / cycleLength) > before
    }

    /// Sets elapsed absolutely from a wall-clock reading (AOD/background-safe).
    /// Returns true if the jump crossed one or more rhythm-check boundaries.
    @discardableResult
    public mutating func set(_ seconds: TimeInterval) -> Bool {
        let before = Int(elapsed / cycleLength)
        elapsed = max(0, seconds)
        return Int(elapsed / cycleLength) > before
    }
}

/// Surviving-Sepsis 1-hour bundle timer (design §06): a 60-minute countdown with
/// escalating-nudge windows near the deadline. Local + deterministic.
public struct SepsisBundleTimer: Sendable {
    public static let totalSeconds: TimeInterval = 3600
    public static let nudgeWindow: TimeInterval = 600   // final 10 minutes

    public private(set) var elapsed: TimeInterval = 0
    public init() {}

    public var remaining: TimeInterval { max(0, Self.totalSeconds - elapsed) }
    public var isExpired: Bool { remaining <= 0 }
    /// Within the final nudge window (but not yet expired).
    public var shouldNudge: Bool { remaining > 0 && remaining <= Self.nudgeWindow }

    public mutating func tick(_ dt: TimeInterval) { elapsed += dt }

    /// Sets elapsed absolutely from a wall-clock reading (AOD/background-safe).
    public mutating func set(_ seconds: TimeInterval) { elapsed = max(0, seconds) }
}
