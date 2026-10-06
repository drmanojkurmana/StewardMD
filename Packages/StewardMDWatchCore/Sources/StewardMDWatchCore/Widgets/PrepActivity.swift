// PrepNucleus readiness snapshot, shared by the PrepWidgets Capacitor plugin (app process: writes it to
// the App Group and starts/updates the Live Activity) and the widget extension (renders the home widget
// and the Live Activity). The web layer (prep-native.js) hands over one JSON string:
//   { "v":1, "score":0-100, "exam":"NEET-PG", "daysLeft":int|null, "done":int, "total":int,
//     "next":string|null, "day":"YYYY-MM-DD", "updated":epoch ms }
// Decoding is deliberately forgiving: wrong types, out-of-range numbers or garbage give nil (the
// widget then shows its "Open PrepNucleus to plan today" placeholder) rather than a crash.
import Foundation

public struct PrepSnapshot: Codable, Hashable, Sendable {
    public static let appGroup = "group.in.stewardmd.app"
    public static let defaultsKey = "prep.widget"
    public static let widgetKind = "StewardMDPrep"
    public static let deepLink = "stewardmd://prep"

    public var score: Int?        // 0...100, nil when not computed yet
    public var exam: String
    public var daysLeft: Int?
    public var done: Int
    public var total: Int
    public var next: String?
    public var day: String?       // local "YYYY-MM-DD" the plan numbers belong to
    public var updated: Double?   // epoch ms

    public init(score: Int?, exam: String, daysLeft: Int?, done: Int, total: Int,
                next: String?, day: String?, updated: Double? = nil) {
        self.score = score; self.exam = exam; self.daysLeft = daysLeft
        self.done = done; self.total = total; self.next = next; self.day = day; self.updated = updated
    }

    /// Parses the web layer's JSON string. Nil for missing, non-object or unknown-version payloads.
    public static func decode(_ json: String?) -> PrepSnapshot? {
        guard let data = json?.data(using: .utf8),
              let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return nil }
        if let v = int(o["v"]), v != 1 { return nil }
        let total = max(0, int(o["total"]) ?? 0)
        let exam = (o["exam"] as? String).map(clean) ?? ""
        return PrepSnapshot(
            score: int(o["score"]).map { min(100, max(0, $0)) },
            exam: exam.isEmpty ? "Exam" : String(exam.prefix(24)),
            daysLeft: int(o["daysLeft"]).map { max(0, $0) },
            done: min(total, max(0, int(o["done"]) ?? 0)),
            total: total,
            next: (o["next"] as? String).map(clean).flatMap { $0.isEmpty ? nil : String($0.prefix(80)) },
            day: o["day"] as? String,
            updated: (o["updated"] as? NSNumber)?.doubleValue)
    }

    /// True when the plan numbers are for the local calendar day containing `date`.
    public func isCurrent(on date: Date = Date(), calendar: Calendar = .current) -> Bool {
        guard let day else { return false }
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return day == String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    /// Start of the next local day: the Live Activity's stale date and the widget's day-rollover entry.
    public static func endOfDay(after date: Date = Date(), calendar: Calendar = .current) -> Date {
        let start = calendar.startOfDay(for: date)
        return calendar.date(byAdding: .day, value: 1, to: start) ?? date.addingTimeInterval(86_400)
    }

    private static func int(_ any: Any?) -> Int? {
        // JSONSerialization gives NSNumber for numbers and for booleans; reject booleans and non-finite.
        guard let n = any as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return nil }
        let d = n.doubleValue
        guard d.isFinite, abs(d) < 1_000_000 else { return nil }
        return Int(d.rounded())
    }

    private static func clean(_ s: String) -> String {
        s.replacingOccurrences(of: "\n", with: " ").trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

#if os(iOS)
import ActivityKit

/// PrepNucleus "today's plan" Live Activity. Static: exam name. Dynamic: progress and readiness.
@available(iOS 16.2, *)
public struct PrepActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        public var done: Int
        public var total: Int
        public var daysLeft: Int?
        public var next: String?
        public var score: Int?
        public init(done: Int, total: Int, daysLeft: Int?, next: String?, score: Int?) {
            self.done = done; self.total = total; self.daysLeft = daysLeft; self.next = next; self.score = score
        }
        public init(_ s: PrepSnapshot) {
            self.init(done: s.done, total: s.total, daysLeft: s.daysLeft, next: s.next, score: s.score)
        }
    }
    public var exam: String
    public init(exam: String) { self.exam = exam }
}
#endif
