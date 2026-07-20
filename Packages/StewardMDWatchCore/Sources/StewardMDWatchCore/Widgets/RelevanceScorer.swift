import Foundation

/// The widget/complication kinds that participate in the Smart Stack.
public enum WidgetKind: String, CaseIterable, Sendable {
    case criticalLabs, patients, rounds, shift, onCall, drugLookup
}

/// Computes Smart Stack relevance so the most useful widget rises on its own
/// (design §09 Relevance API): time of day, shift phase, unread criticals. Pure
/// and deterministic (clock injectable) → fully unit-testable.
public enum RelevanceScorer {
    public static func score(_ state: GlanceState, hour: Int, now: Date = Date()) -> [WidgetKind: Double] {
        var s: [WidgetKind: Double] = [:]

        // Criticals dominate whenever any are unread.
        s[.criticalLabs] = state.criticalCount > 0 ? 1.0 : 0.2

        // On-call is highly relevant whenever the bleep is held.
        s[.onCall] = state.onCall ? 0.9 : 0.1

        // Rounds peak mid-morning (08–11), taper after.
        s[.rounds] = state.roundsTotal > 0 ? roundsScore(hour: hour) : 0.1

        // Shift timer rises within 90 minutes of the shift end.
        s[.shift] = shiftScore(endsAt: state.shiftEndsAt, now: now)

        // Steady baselines.
        s[.patients] = 0.5
        s[.drugLookup] = 0.3

        return s
    }

    private static func roundsScore(hour: Int) -> Double {
        switch hour {
        case 8...11: return 0.8
        case 12...17: return 0.4
        default: return 0.2
        }
    }

    private static func shiftScore(endsAt: Double?, now: Date) -> Double {
        guard let end = endsAt else { return 0.2 }
        let remaining = end - now.timeIntervalSince1970
        guard remaining > 0 else { return 0.2 }
        return remaining <= 90 * 60 ? 0.85 : 0.3
    }
}
