import Foundation

/// A Digital-Crown-driven numeric field (design §04: "Crown dials every numeric
/// input"). `value` is always clamped to `[min, max]`; views bind it directly to
/// `.digitalCrownRotation`. Pure + testable.
public struct CrownField: Equatable, Sendable {
    public let min: Double
    public let max: Double
    public let step: Double

    /// Clamped on every assignment (safe to bind directly). Assigning inside the
    /// observer does not re-trigger it, so there is no recursion.
    public var value: Double {
        didSet { value = Swift.min(Swift.max(value, min), max) }
    }

    public init(value: Double, min: Double, max: Double, step: Double) {
        self.min = min; self.max = max; self.step = step
        self.value = Swift.min(Swift.max(value, min), max)
    }

    public mutating func set(_ v: Double) { value = v }
    public mutating func increment() { value += step }
    public mutating func decrement() { value -= step }

    /// Position within the range, 0…1 (for gauges/markers).
    public var normalized: Double {
        max > min ? (value - min) / (max - min) : 0
    }
}
