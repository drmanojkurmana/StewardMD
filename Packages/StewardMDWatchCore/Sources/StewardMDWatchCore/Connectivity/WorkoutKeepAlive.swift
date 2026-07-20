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
