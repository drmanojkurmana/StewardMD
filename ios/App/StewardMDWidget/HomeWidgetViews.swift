import SwiftUI
import WidgetKit
import StewardMDWatchCore

// Home-screen widget views (design §07). One view per widget, laid out per `\.widgetFamily`.
// Colour always pairs with an icon/number so a tile reads without relying on colour alone.

/// True when the snapshot is older than 15 minutes (design's staleness rule → show a muted dot).
private func isStale(_ state: GlanceState) -> Bool {
    state.updatedAt > 0 && (Date().timeIntervalSince1970 - state.updatedAt) > 15 * 60
}

private struct StaleDot: View {
    let state: GlanceState
    var body: some View {
        if isStale(state) {
            Image(systemName: "clock.badge.exclamationmark")
                .font(.caption2).foregroundStyle(.secondary)
                .accessibilityLabel("Data may be stale")
        }
    }
}

private struct WidgetHeader: View {
    let title: String
    let systemImage: String
    let tint: Color
    var body: some View {
        Label(title, systemImage: systemImage)
            .font(.caption2).bold().textCase(.uppercase)
            .foregroundStyle(tint)
            .labelStyle(.titleAndIcon)
    }
}

// MARK: - Critical Labs

struct CriticalLabsHomeView: View {
    @Environment(\.widgetFamily) private var family
    let state: GlanceState
    private var tint: Color { state.criticalCount > 0 ? SMDPalette.critical.color : SMDPalette.text2.color }

    var body: some View {
        switch family {
        case .systemMedium:
            VStack(alignment: .leading, spacing: 6) {
                HStack { WidgetHeader(title: "Critical labs", systemImage: "exclamationmark.triangle.fill", tint: tint); Spacer(); StaleDot(state: state) }
                Text(state.topCritical ?? (state.criticalCount > 0 ? "\(state.criticalCount) results" : "No criticals"))
                    .font(.title3).bold().monospacedDigit().lineLimit(1)
                Text("\(state.criticalCount) unacknowledged\(state.ward.map { " · \($0)" } ?? "")")
                    .font(.caption).foregroundStyle(.secondary)
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        default: // systemSmall
            VStack(alignment: .leading, spacing: 4) {
                HStack { Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(tint); Spacer(); StaleDot(state: state) }
                Text("\(state.criticalCount)").font(.system(size: 44, weight: .bold, design: .rounded)).foregroundStyle(tint)
                Text(state.criticalCount == 1 ? "critical" : "criticals").font(.caption).foregroundStyle(.secondary)
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - ICU Watchlist

struct ICUWatchlistHomeView: View {
    @Environment(\.widgetFamily) private var family
    let state: GlanceState
    private var newsTint: Color {
        guard let n = state.watchlistNews else { return SMDPalette.teal.color }
        return n >= 7 ? SMDPalette.critical.color : (n >= 5 ? SMDPalette.warning.color : SMDPalette.teal.color)
    }
    private var top: String { state.watchlistTop ?? "\(state.patientCount) patients" }

    var body: some View {
        switch family {
        case .systemLarge:
            VStack(alignment: .leading, spacing: 10) {
                HStack { WidgetHeader(title: "ICU watchlist", systemImage: "person.2.fill", tint: newsTint); Spacer(); StaleDot(state: state) }
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(state.watchlistNews.map { "NEWS2 \($0)" } ?? "—").font(.title2).bold().foregroundStyle(newsTint)
                    Spacer()
                }
                Text(top).font(.headline).lineLimit(2)
                Divider()
                gridStat("Patients", "\(state.patientCount)")
                gridStat("Criticals", "\(state.criticalCount)")
                gridStat("Census", "\(state.censusOccupied)/\(state.censusTotal)")
                gridStat("Open tasks", "\(state.tasksDue)")
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        case .systemMedium:
            VStack(alignment: .leading, spacing: 6) {
                HStack { WidgetHeader(title: "ICU watchlist", systemImage: "person.2.fill", tint: newsTint); Spacer(); StaleDot(state: state) }
                Text(top).font(.title3).bold().lineLimit(1)
                Text("\(state.patientCount) patients · \(state.criticalCount) critical · census \(state.censusOccupied)/\(state.censusTotal)")
                    .font(.caption).foregroundStyle(.secondary)
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        default: // systemSmall
            VStack(alignment: .leading, spacing: 4) {
                HStack { Image(systemName: "person.2.fill").foregroundStyle(newsTint); Spacer(); StaleDot(state: state) }
                Text(state.watchlistNews.map { "\($0)" } ?? "\(state.patientCount)")
                    .font(.system(size: 40, weight: .bold, design: .rounded)).foregroundStyle(newsTint)
                Text(state.watchlistNews != nil ? "top NEWS2" : "patients").font(.caption).foregroundStyle(.secondary)
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func gridStat(_ label: String, _ value: String) -> some View {
        HStack { Text(label).font(.caption).foregroundStyle(.secondary); Spacer(); Text(value).font(.caption).bold().monospacedDigit() }
    }
}

// MARK: - Tasks & rounds

struct TasksHomeView: View {
    @Environment(\.widgetFamily) private var family
    let state: GlanceState

    var body: some View {
        switch family {
        case .systemMedium:
            HStack(spacing: 14) {
                VStack(alignment: .leading, spacing: 4) {
                    WidgetHeader(title: "Open tasks", systemImage: "checklist", tint: SMDPalette.teal.color)
                    Text("\(state.tasksDue)").font(.system(size: 40, weight: .bold, design: .rounded))
                    Text("to do").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Gauge(value: state.roundsFraction) {
                    Text("\(state.roundsDone)/\(state.roundsTotal)").font(.caption2)
                }
                .gaugeStyle(.accessoryCircularCapacity)
                .tint(SMDPalette.teal.color)
                .scaleEffect(1.2)
            }
        default: // systemSmall
            VStack(alignment: .leading, spacing: 4) {
                WidgetHeader(title: "Tasks", systemImage: "checklist", tint: SMDPalette.teal.color)
                Text("\(state.tasksDue)").font(.system(size: 44, weight: .bold, design: .rounded))
                Text("rounds \(state.roundsDone)/\(state.roundsTotal)").font(.caption).foregroundStyle(.secondary)
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Ward census

struct RoundsCensusHomeView: View {
    let state: GlanceState
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            WidgetHeader(title: "Census", systemImage: "bed.double.fill", tint: SMDPalette.teal.color)
            Gauge(value: state.censusFraction) {
                Text("\(state.censusOccupied)/\(state.censusTotal)").font(.caption2)
            } currentValueLabel: {
                Text("\(Int(state.censusFraction * 100))%").font(.caption2)
            }
            .gaugeStyle(.accessoryCircularCapacity)
            .tint(SMDPalette.teal.color)
            Text("rounds \(state.roundsDone)/\(state.roundsTotal)").font(.caption2).foregroundStyle(.secondary)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
