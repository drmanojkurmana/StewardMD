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
/// A general ongoing event the PHONE app starts itself (ICU task deadline, OPD consult in progress),
/// unlike the timers above which the watch starts. One activity per `key`. The clock ticks natively:
/// counting down to `endsAt` when set, else counting up from `startedAt`.
/// PRIVACY: shown on the Lock Screen, so title/detail carry counts, token numbers and times only
/// (live-activities.js sanitizes; callers never pass a patient name, ID, bed or diagnosis).
@available(iOS 16.2, *)
public struct ClinicalActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        public var title: String
        public var detail: String
        public var startedAt: Date
        public var endsAt: Date?
        public var urgent: Bool
        public init(title: String, detail: String, startedAt: Date, endsAt: Date? = nil, urgent: Bool = false) {
            self.title = title; self.detail = detail; self.startedAt = startedAt; self.endsAt = endsAt; self.urgent = urgent
        }
    }
    public var key: String
    public var symbol: String      // SF Symbol name
    public var tintHex: String     // "#RRGGBB"
    public init(key: String, symbol: String = "timer", tintHex: String = "#0F766E") {
        self.key = key; self.symbol = symbol; self.tintHex = tintHex
    }
}
#endif
