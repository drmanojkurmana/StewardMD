import Foundation

/// Epinephrine reminder state, derived from the last logged dose (spec: due
/// 180 s after the last epinephrine, overdue 300 s after it, all modes).
/// Before the first dose there is no countdown; the guide says when it is
/// indicated. Name and timing only, never doses.
public enum EpiStatus: String, Sendable, Equatable {
    /// No dose logged yet, countdown not started.
    case none
    /// Within 180 s of the last dose.
    case notDue
    /// 180 s to 300 s after the last dose.
    case due
    /// 300 s or more after the last dose.
    case overdue
}

public enum EpiSchedule: Sendable {
    /// Due 180 s after the last dose (3 min rule).
    public static let dueAfter: TimeInterval = 180
    /// Overdue 300 s after the last dose (3 to 5 min rule).
    public static let overdueAfter: TimeInterval = 300

    public static func status(secondsSinceLastDose: TimeInterval?) -> EpiStatus {
        guard let s = secondsSinceLastDose else { return .none }
        if s >= overdueAfter { return .overdue }
        if s >= dueAfter { return .due }
        return .notDue
    }

    /// Elapsed time of the most recent epinephrine/adrenaline drug event, if any.
    public static func lastDoseElapsed(events: [CodeEvent]) -> TimeInterval? {
        events.filter { isEpinephrineEvent($0) }.map(\.elapsed).max()
    }

    public static func isEpinephrineEvent(_ e: CodeEvent) -> Bool {
        guard e.kind == .drug else { return false }
        let l = e.label.lowercased()
        return l.contains("epinephrine") || l.contains("adrenaline")
    }
}
