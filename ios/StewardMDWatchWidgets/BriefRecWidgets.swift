import WidgetKit
import SwiftUI
import StewardMDWatchCore

// New Smart Stack tiles (design §11/§15) — additive, same GlanceState + GlanceProvider pattern as the
// shipping widgets. Views pick a layout per accessory family; each deep-links so it's never a dead end.

// MARK: - Morning Brief (AI)

/// A one-line AI morning brief (census, criticals, jobs) — rises early in the day via RelevanceScorer.
struct MorningBriefWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "StewardMDMorningBrief",
                            provider: GlanceProvider(kind: .morningBrief)) { entry in
            MorningBriefView(state: entry.state)
                .widgetURL(URL(string: "stewardmd://home"))
                .containerBackground(.clear, for: .widget)
        }
        .configurationDisplayName("Morning brief")
        .description("Your AI start-of-day summary.")
        .supportedFamilies([.accessoryRectangular, .accessoryInline])
    }
}

struct MorningBriefView: View {
    @Environment(\.widgetFamily) private var family
    let state: GlanceState
    private var brief: String { (state.briefText?.isEmpty == false ? state.briefText! : "Open StewardMD for today's brief") }

    var body: some View {
        switch family {
        case .accessoryInline:
            Label(brief, systemImage: "sparkles")
        default: // .accessoryRectangular
            VStack(alignment: .leading, spacing: 1) {
                Label("MORNING BRIEF", systemImage: "sparkles")
                    .font(.caption2).bold().foregroundStyle(SMDPalette.accent.color)
                    .labelStyle(.titleAndIcon)
                Text(brief).font(.footnote).lineLimit(2)
            }
        }
    }
}

// MARK: - Antibiotic Rec

/// The last on-device MARINAM antibiotic recommendation — a quick bedside recall tile.
struct AntibioticRecWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "StewardMDAntibioticRec",
                            provider: GlanceProvider(kind: .antibioticRec)) { entry in
            AntibioticRecView(state: entry.state)
                .widgetURL(URL(string: "stewardmd://home"))
                .containerBackground(.clear, for: .widget)
        }
        .configurationDisplayName("Antibiotic rec")
        .description("Your last antibiotic recommendation.")
        .supportedFamilies([.accessoryRectangular, .accessoryInline])
    }
}

struct AntibioticRecView: View {
    @Environment(\.widgetFamily) private var family
    let state: GlanceState
    private var rec: String { (state.antibioticRec?.isEmpty == false ? state.antibioticRec! : "No recent recommendation") }

    var body: some View {
        switch family {
        case .accessoryInline:
            Label(rec, systemImage: "cross.case.fill")
        default:
            VStack(alignment: .leading, spacing: 1) {
                Label("LAST REC", systemImage: "cross.case.fill")
                    .font(.caption2).bold().foregroundStyle(SMDPalette.teal.color)
                    .labelStyle(.titleAndIcon)
                Text(rec).font(.headline).lineLimit(2)
            }
        }
    }
}

// MARK: - ICU Watchlist

/// Highest-acuity patient by NEWS2 — a compact "who to see first" tile, tinted by severity.
struct ICUWatchlistWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "StewardMDWatchlist",
                            provider: GlanceProvider(kind: .watchlist)) { entry in
            ICUWatchlistView(state: entry.state)
                .widgetURL(URL(string: "stewardmd://patients"))
                .containerBackground(.clear, for: .widget)
        }
        .configurationDisplayName("ICU watchlist")
        .description("Highest-acuity patient right now.")
        .supportedFamilies([.accessoryRectangular, .accessoryCircular, .accessoryInline])
    }
}

struct ICUWatchlistView: View {
    @Environment(\.widgetFamily) private var family
    let state: GlanceState
    private var top: String { (state.watchlistTop?.isEmpty == false ? state.watchlistTop! : "\(state.patientCount) patients") }
    private var tint: Color {
        guard let n = state.watchlistNews else { return SMDPalette.teal.color }
        return n >= 7 ? SMDPalette.critical.color : (n >= 5 ? SMDPalette.warning.color : SMDPalette.teal.color)
    }

    var body: some View {
        switch family {
        case .accessoryInline:
            Label(top, systemImage: "person.2.fill")
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    Text("NEWS2").font(.system(size: 9)).foregroundStyle(.secondary)
                    Text(state.watchlistNews.map(String.init) ?? "—")
                        .font(.system(.title2, design: .rounded)).bold()
                        .foregroundStyle(tint)
                }
            }
        default: // .accessoryRectangular
            VStack(alignment: .leading, spacing: 1) {
                Label("WATCHLIST", systemImage: "person.2.fill")
                    .font(.caption2).bold().foregroundStyle(tint)
                    .labelStyle(.titleAndIcon)
                Text(top).font(.headline).lineLimit(1)
                if let n = state.watchlistNews {
                    Text("NEWS2 \(n)").font(.caption2).foregroundStyle(.secondary)
                }
            }
        }
    }
}
