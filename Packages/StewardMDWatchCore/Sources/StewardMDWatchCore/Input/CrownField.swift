import Foundation

/// A Digital-Crown-driven numeric field (design §04: "Crown dials every numeric
/// input"). Holds a value clamped to `[min, max]` with a `step`; the view binds
/// `.digitalCrownRotation` to `value`. Pure + testable.
public struct CrownField: Equatable, Sendable {
    public private(set) var value: Double
    public let min: Double
    public let max: Double
    public let step: Double

    public init(value: Double, min: Double, max: Double, step: Double) {
        self.min = min; self.max = max; self.step = step
        self.value = Swift.min(Swift.max(value, min), max)
    }

    public mutating func set(_ v: Double) {
        value = Swift.min(Swift.max(v, min), max)
    }
    public mutating func increment() { set(value + step) }
    public mutating func decrement() { set(value - step) }

    /// Position within the range, 0…1 (for gauges/markers).
    public var normalized: Double {
        max > min ? (value - min) / (max - min) : 0
    }
}
