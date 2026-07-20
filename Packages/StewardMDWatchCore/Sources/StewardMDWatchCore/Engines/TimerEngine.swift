import Foundation

/// ACLS / Code Blue timer (design §06). Counts elapsed time, marks 2-minute
/// rhythm-check cycles, and reports the countdown to the next check. Fully
/// local — never depends on the network. Advanced by `tick(_:)` from the
/// watch's display-link / timer so it is deterministic and unit-testable.
public struct CodeBlueTimer: Sendable {
    public static let cycleSeconds: TimeInterval = 120

    public private(set) var elapsed: TimeInterval = 0
    public init() {}

    /// 1-based cycle number.
    public var cycle: Int { Int(elapsed / Self.cycleSeconds) + 1 }

    /// Seconds until the next 2-minute rhythm check.
    public var secondsToNextRhythmCheck: TimeInterval {
        let r = elapsed.truncatingRemainder(dividingBy: Self.cycleSeconds)
        return r == 0 ? Self.cycleSeconds : Self.cycleSeconds - r
    }

    /// Advances the clock. Returns `true` if a rhythm-check boundary was crossed
    /// during this tick (the caller fires the cycle haptic).
    @discardableResult
    public mutating func tick(_ dt: TimeInterval) -> Bool {
        let before = Int(elapsed / Self.cycleSeconds)
        elapsed += dt
        return Int(elapsed / Self.cycleSeconds) > before
    }

    /// Sets elapsed absolutely from a wall-clock reading (AOD/background-safe).
    /// Returns true if the jump crossed one or more rhythm-check boundaries.
    @discardableResult
    public mutating func set(_ seconds: TimeInterval) -> Bool {
        let before = Int(elapsed / Self.cycleSeconds)
        elapsed = max(0, seconds)
        return Int(elapsed / Self.cycleSeconds) > before
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
