import Foundation

/// "Honest staleness" (design §12): relayed patient/lab data is read-only offline
/// with an "as of HH:MM" stamp and a stale banner past 15 minutes.
public enum StalenessPolicy {
    public static let staleAfter: TimeInterval = 15 * 60

    public static func isStale(asOf: Date, now: Date = Date()) -> Bool {
        now.timeIntervalSince(asOf) > staleAfter
    }

    /// "as of HH:MM" label. Time zone injectable so tests are deterministic.
    public static func asOfLabel(_ date: Date, timeZone: TimeZone = .current) -> String {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = timeZone
        let c = cal.dateComponents([.hour, .minute], from: date)
        return String(format: "as of %02d:%02d", c.hour ?? 0, c.minute ?? 0)
    }
}
