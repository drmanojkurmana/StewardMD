import Foundation

/// The widget/complication kinds that participate in the Smart Stack.
public enum WidgetKind: String, CaseIterable, Sendable {
    case criticalLabs, patients, rounds, shift, onCall, drugLookup
    // New tiles (design §15):
    case morningBrief, antibioticRec, watchlist
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

        // Morning Brief peaks at the start of the day (06–09) when a brief exists.
        s[.morningBrief] = state.briefText?.isEmpty == false ? briefScore(hour: hour) : 0.1

        // ICU Watchlist rises with the top patient's acuity; steady when a roster exists.
        if let n = state.watchlistNews { s[.watchlist] = n >= 7 ? 0.75 : (n >= 5 ? 0.6 : 0.45) }
        else { s[.watchlist] = state.patientCount > 0 ? 0.45 : 0.1 }

        // Steady baselines.
        s[.patients] = 0.5
        s[.antibioticRec] = state.antibioticRec?.isEmpty == false ? 0.35 : 0.1
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

    private static func briefScore(hour: Int) -> Double {
        switch hour {
        case 6...9: return 0.9
        case 10...12: return 0.5
        default: return 0.25
        }
    }

    private static func shiftScore(endsAt: Double?, now: Date) -> Double {
        guard let end = endsAt else { return 0.2 }
        let remaining = end - now.timeIntervalSince1970
        guard remaining > 0 else { return 0.2 }
        return remaining <= 90 * 60 ? 0.85 : 0.3
    }
}
