import WidgetKit
import SwiftUI
import StewardMDWatchCore

// iOS home-screen / Lock-screen / StandBy widgets (design §07/§08/§15). These reuse the SAME shared
// StewardMDWatchCore models the watch uses — GlanceState (App Group snapshot), AppGroupStore, and
// RelevanceScorer — so there is one source of truth across watch + phone.
//
// SETUP (must be done in Xcode — see ios/App/StewardMDWidgets/README.md):
//   • This is a Widget Extension target embedded in the App (Capacitor) iOS app.
//   • Add capability "App Groups" → group.in.stewardmd.app to BOTH this target and the App target.
//   • Add the StewardMDWatchCore package to this target's "Frameworks and Libraries".
//   • The iPhone app must write GlanceState to the App Group (AppGroupStore().saveGlance) so these
//     tiles show live data — otherwise they render the sample/placeholder.

@main
struct StewardMDWidgetsBundle: WidgetBundle {
    var body: some Widget {
        CriticalLabsHomeWidget()
        ICUWatchlistHomeWidget()
        TasksHomeWidget()
        RoundsCensusHomeWidget()
        // Lock Screen / StandBy accessory widgets (design §08)
        CriticalLabsLockWidget()
        RoundsLockWidget()
        StewardMDBrandLockWidget()
        DrugIndexLockWidget()
        ICUDashboardLockWidget()
        MaikLockWidget()
        // Code Blue Live Activity (Lock Screen + Dynamic Island)
        if #available(iOS 16.2, *) {
            CodeBlueLiveActivity()
            SepsisLiveActivity()
            ProcedureLiveActivity()
        }
        // Control Center / Action-button Controls (iOS 18+)
        if #available(iOS 18.0, *) {
            StartCodeBlueControl()
            AskMaikControl()
            DrugLookupControl()
        }
    }
}

// MARK: - Timeline provider (iOS)

struct HomeGlanceEntry: TimelineEntry {
    let date: Date
    let state: GlanceState
}

/// Reads the shared GlanceState from the App Group. Push-first: the app calls
/// WidgetCenter.shared.reloadAllTimelines() on update; this 30-min floor is a budget-safe backstop.
struct HomeGlanceProvider: TimelineProvider {
    private let store = AppGroupStore()

    func placeholder(in context: Context) -> HomeGlanceEntry { HomeGlanceEntry(date: Date(), state: Self.sample) }

    func getSnapshot(in context: Context, completion: @escaping (HomeGlanceEntry) -> Void) {
        completion(HomeGlanceEntry(date: Date(), state: context.isPreview ? Self.sample : store.loadGlance()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<HomeGlanceEntry>) -> Void) {
        let e = HomeGlanceEntry(date: Date(), state: store.loadGlance())
        let next = Calendar.current.date(byAdding: .minute, value: 30, to: e.date) ?? e.date
        completion(Timeline(entries: [e], policy: .after(next)))
    }

    static let sample = GlanceState(
        criticalCount: 3, topCritical: "K⁺ 6.8 · Bed 12", patientCount: 12, tasksDue: 3,
        roundsDone: 8, roundsTotal: 12, censusOccupied: 28, censusTotal: 32, onCall: true, ward: "MICU",
        watchlistTop: "Bed 12 · NEWS2 9", watchlistNews: 9, updatedAt: Date().timeIntervalSince1970)
}

// MARK: - Widgets

struct CriticalLabsHomeWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "StewardMDHomeCriticalLabs", provider: HomeGlanceProvider()) { entry in
            CriticalLabsHomeView(state: entry.state)
                .smdWatermark()
                .widgetURL(URL(string: "stewardmd://criticalLabs"))
                .containerBackground(Color(.sRGB, red: 1, green: 1, blue: 1), for: .widget)
        }
        .configurationDisplayName("Critical labs")
        .description("Unacknowledged critical results across your unit.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct ICUWatchlistHomeWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "StewardMDHomeWatchlist", provider: HomeGlanceProvider()) { entry in
            ICUWatchlistHomeView(state: entry.state)
                .smdWatermark(.bottomTrailing, size: 52, opacity: 0.05)
                .widgetURL(URL(string: "stewardmd://patients"))
                .containerBackground(Color(.sRGB, red: 1, green: 1, blue: 1), for: .widget)
        }
        .configurationDisplayName("ICU watchlist")
        .description("Highest-acuity patients right now.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

struct TasksHomeWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "StewardMDHomeTasks", provider: HomeGlanceProvider()) { entry in
            TasksHomeView(state: entry.state)
                .smdWatermark()
                .widgetURL(URL(string: "stewardmd://tasks"))
                .containerBackground(Color(.sRGB, red: 1, green: 1, blue: 1), for: .widget)
        }
        .configurationDisplayName("Tasks & rounds")
        .description("Open jobs and round progress.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct RoundsCensusHomeWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "StewardMDHomeCensus", provider: HomeGlanceProvider()) { entry in
            RoundsCensusHomeView(state: entry.state)
                .smdWatermark(.topTrailing, size: 28, opacity: 0.06)
                .widgetURL(URL(string: "stewardmd://home"))
                .containerBackground(Color(.sRGB, red: 1, green: 1, blue: 1), for: .widget)
        }
        .configurationDisplayName("Ward census")
        .description("Occupancy and rounds at a glance.")
        .supportedFamilies([.systemSmall])
    }
}

// MARK: - Lock Screen / StandBy accessory widgets

struct CriticalLabsLockWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "StewardMDLockCritical", provider: HomeGlanceProvider()) { entry in
            CriticalLabsLockView(state: entry.state)
                .widgetURL(URL(string: "stewardmd://criticalLabs"))
                .containerBackground(.clear, for: .widget)
        }
        .configurationDisplayName("Critical labs")
        .description("Unacknowledged criticals on the Lock Screen.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

struct RoundsLockWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "StewardMDLockRounds", provider: HomeGlanceProvider()) { entry in
            RoundsLockView(state: entry.state)
                .widgetURL(URL(string: "stewardmd://home"))
                .containerBackground(.clear, for: .widget)
        }
        .configurationDisplayName("Rounds progress")
        .description("Rounds completed, at a glance.")
        .supportedFamilies([.accessoryCircular])
    }
}

struct StewardMDBrandLockWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "StewardMDLockShortcut", provider: HomeGlanceProvider()) { _ in
            BrandLockView()
                .widgetURL(URL(string: "stewardmd://home"))
                .containerBackground(.clear, for: .widget)
        }
        .configurationDisplayName("StewardMD")
        .description("Open StewardMD from the Lock Screen.")
        .supportedFamilies([.accessoryCircular])
    }
}

// Quick-action circular launchers (Lock Screen). Each opens a stewardmd:// route.

struct DrugIndexLockWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "StewardMDLockDrugs", provider: HomeGlanceProvider()) { _ in
            ShortcutLockView(systemImage: "pills.fill")
                .widgetURL(URL(string: "stewardmd://drugs"))
                .containerBackground(.clear, for: .widget)
        }
        .configurationDisplayName("Drug index")
        .description("Open the drug lookup from the Lock Screen.")
        .supportedFamilies([.accessoryCircular])
    }
}

struct ICUDashboardLockWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "StewardMDLockICU", provider: HomeGlanceProvider()) { _ in
            ShortcutLockView(systemImage: "waveform.path.ecg")
                .widgetURL(URL(string: "stewardmd://icu"))
                .containerBackground(.clear, for: .widget)
        }
        .configurationDisplayName("ICU dashboard")
        .description("Open the ICU dashboard from the Lock Screen.")
        .supportedFamilies([.accessoryCircular])
    }
}

struct MaikLockWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "StewardMDLockMaik", provider: HomeGlanceProvider()) { _ in
            ShortcutLockView(systemImage: "sparkles")
                .widgetURL(URL(string: "stewardmd://askai"))
                .containerBackground(.clear, for: .widget)
        }
        .configurationDisplayName("Ask MaiK")
        .description("Open the MaiK assistant from the Lock Screen.")
        .supportedFamilies([.accessoryCircular])
    }
}
