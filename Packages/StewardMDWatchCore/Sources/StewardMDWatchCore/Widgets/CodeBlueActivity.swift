// Shared ActivityKit attributes for the Code Blue Live Activity (design §09). Defined here so BOTH the
// iPhone app (which starts/updates the Activity) and the widget extension (which renders it) use one
// type. Guarded on ActivityKit availability so the watchOS/macOS builds of this package are unaffected
// (Live Activities are iOS/iPadOS only).
#if os(iOS)
import ActivityKit
import Foundation

@available(iOS 16.2, *)
public struct CodeBlueActivityAttributes: ActivityAttributes {
    /// The dynamic, frequently-updated portion — mirrors the live CodeBlueState fields that matter on
    /// the Lock Screen / Dynamic Island. Kept small (ActivityKit payloads are size-limited).
    public struct ContentState: Codable, Hashable {
        public var elapsed: TimeInterval
        public var cycle: Int
        public var averageRateCPM: Int
        public var coachZone: String     // "low" | "inTarget" | "high" | "idle" — from RateZone
        public var shockCount: Int
        public var adrenalineCount: Int
        public var targetRatePct: Int     // % time in the 100–120 band
        public var paused: Bool
        public var rosc: Bool

        public init(elapsed: TimeInterval = 0, cycle: Int = 1, averageRateCPM: Int = 0,
                    coachZone: String = "idle", shockCount: Int = 0, adrenalineCount: Int = 0,
                    targetRatePct: Int = 0, paused: Bool = false, rosc: Bool = false) {
            self.elapsed = elapsed; self.cycle = cycle; self.averageRateCPM = averageRateCPM
            self.coachZone = coachZone; self.shockCount = shockCount
            self.adrenalineCount = adrenalineCount; self.targetRatePct = targetRatePct
            self.paused = paused; self.rosc = rosc
        }
    }

    /// Static for the life of the activity — which unit/bed the code is running in.
    public var unit: String
    public init(unit: String) { self.unit = unit }
}

@available(iOS 16.2, *)
public extension CodeBlueActivityAttributes.ContentState {
    /// Build the content state from the live CodeBlueState (the app calls this when updating the Activity).
    static func from(_ s: CodeBlueState) -> CodeBlueActivityAttributes.ContentState {
        CodeBlueActivityAttributes.ContentState(
            elapsed: s.elapsed, cycle: s.cycle, averageRateCPM: s.averageRateCPM,
            coachZone: String(describing: s.coachZone), shockCount: s.shockCount,
            adrenalineCount: s.adrenalineCount, targetRatePct: s.targetRatePct,
            paused: s.paused, rosc: s.rosc)
    }
}
#endif
