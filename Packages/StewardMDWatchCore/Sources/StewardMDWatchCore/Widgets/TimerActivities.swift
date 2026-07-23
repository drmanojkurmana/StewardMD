// Shared ActivityKit attributes for the Sepsis-bundle and Procedure Live Activities (design §09).
// Unlike Code Blue (which streams full state), these are TIMERS — the watch sends one start/stop
// message with a start-date, and the widget renders the running clock NATIVELY (Text(timerInterval:)/
// .timer style), so no per-second updates are needed. iOS-only (Live Activities aren't on watchOS).
#if os(iOS)
import ActivityKit
import Foundation

/// Surviving-Sepsis 1-hour bundle countdown + checklist progress.
@available(iOS 16.2, *)
public struct SepsisActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        public var bundleDone: Int      // 0…4 (cultures / lactate / antibiotics / fluids)
        public var expired: Bool
        public init(bundleDone: Int = 0, expired: Bool = false) {
            self.bundleDone = bundleDone; self.expired = expired
        }
    }
    public var startedAt: Date
    public var targetSeconds: Double     // 3600 for the 1-hour bundle
    public init(startedAt: Date, targetSeconds: Double = 3600) {
        self.startedAt = startedAt; self.targetSeconds = targetSeconds
    }
    /// Deadline the widget counts down to.
    public var deadline: Date { startedAt.addingTimeInterval(targetSeconds) }
}

/// A count-up procedure stopwatch (time-outs, sterile-field timing).
@available(iOS 16.2, *)
public struct ProcedureActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        public var running: Bool
        public init(running: Bool = true) { self.running = running }
    }
    public var startedAt: Date
    public var label: String
    public init(startedAt: Date, label: String = "Procedure") {
        self.startedAt = startedAt; self.label = label
    }
}
#endif
