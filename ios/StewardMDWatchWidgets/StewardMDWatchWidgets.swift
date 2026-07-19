import WidgetKit
import SwiftUI
import StewardMDWatchCore

/// WidgetKit bundle for the watch: complications + Smart Stack widgets. Phase 1
/// ships one accessory-rectangular complication reading shared App Group state;
/// Phase 3 expands to every family (circular/corner/inline/XL/bezel) + Smart
/// Stack with the Relevance API. Every widget deep-links into the app.
@main
struct StewardMDWatchWidgets: WidgetBundle {
    var body: some Widget {
        StatusComplication()
    }
}

// MARK: - Timeline

struct StatusEntry: TimelineEntry {
    let date: Date
    let signedIn: Bool
    let favoritesCount: Int
}

struct StatusProvider: TimelineProvider {
    private let store = AppGroupStore()

    func placeholder(in context: Context) -> StatusEntry {
        StatusEntry(date: .now, signedIn: true, favoritesCount: 3)
    }

    func getSnapshot(in context: Context, completion: @escaping (StatusEntry) -> Void) {
        completion(currentEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<StatusEntry>) -> Void) {
        // Push-driven: reload on APNs / WidgetCenter.reloadAllTimelines(); otherwise
        // refresh hourly as a budget-safe floor.
        let next = Calendar.current.date(byAdding: .hour, value: 1, to: .now) ?? .now
        completion(Timeline(entries: [currentEntry()], policy: .after(next)))
    }

    private func currentEntry() -> StatusEntry {
        let session = store.loadSession() ?? .none
        return StatusEntry(date: .now, signedIn: session.uid != nil, favoritesCount: store.loadFavorites().count)
    }
}

// MARK: - Complication

struct StatusComplication: Widget {
    let kind = "StewardMDStatus"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: StatusProvider()) { entry in
            StatusView(entry: entry)
        }
        .configurationDisplayName("StewardMD")
        .description("Status at a glance.")
        .supportedFamilies([.accessoryRectangular, .accessoryInline])
    }
}

struct StatusView: View {
    let entry: StatusEntry
    var body: some View {
        HStack(spacing: SMDSpacing.s) {
            Image(systemName: "cross.case.fill")
                .foregroundStyle(SMDPalette.accent.color)
            VStack(alignment: .leading) {
                Text("StewardMD").font(.headline)
                Text(entry.signedIn ? "On call" : "Sign in on iPhone")
                    .font(.caption)
                    .foregroundStyle(SMDPalette.text2.color)
            }
        }
        .containerBackground(.clear, for: .widget)
    }
}
