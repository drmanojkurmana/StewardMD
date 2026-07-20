import WidgetKit
import StewardMDWatchCore

/// One timeline entry carrying the shared glance snapshot + a Smart Stack
/// relevance score for this widget's kind.
struct GlanceEntry: TimelineEntry {
    let date: Date
    let state: GlanceState
    let relevance: TimelineEntryRelevance?
}

/// Shared provider for every complication + Smart Stack widget. Reads
/// `GlanceState` from the App Group and stamps a per-kind relevance so the stack
/// self-orders (design §09). Push-driven: the app calls
/// `WidgetCenter.reloadAllTimelines()`; this hourly floor is a budget-safe backstop.
struct GlanceProvider: TimelineProvider {
    let kind: WidgetKind
    private let store = AppGroupStore()

    func placeholder(in context: Context) -> GlanceEntry {
        GlanceEntry(date: Date(), state: sampleState, relevance: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (GlanceEntry) -> Void) {
        completion(entry(context.isPreview ? sampleState : store.loadGlance()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<GlanceEntry>) -> Void) {
        let e = entry(store.loadGlance())
        let next = Calendar.current.date(byAdding: .hour, value: 1, to: e.date) ?? e.date
        completion(Timeline(entries: [e], policy: .after(next)))
    }

    private func entry(_ state: GlanceState) -> GlanceEntry {
        let hour = Calendar.current.component(.hour, from: Date())
        let score = RelevanceScorer.score(state, hour: hour)[kind] ?? 0.3
        return GlanceEntry(date: Date(), state: state,
                           relevance: TimelineEntryRelevance(score: Float(score)))
    }

    private var sampleState: GlanceState {
        GlanceState(criticalCount: 3, topCritical: "K⁺ 6.8 · Bed 12", patientCount: 12,
                    tasksDue: 3, roundsDone: 8, roundsTotal: 12, censusOccupied: 28,
                    censusTotal: 32, shiftEndsAt: nil, onCall: true, ward: "Ward 7",
                    bleep: "2231", updatedAt: Date().timeIntervalSince1970)
    }
}
