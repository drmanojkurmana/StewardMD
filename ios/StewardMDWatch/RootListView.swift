import SwiftUI
import StewardMDWatchCore

/// Root vertical list (design §04): six ways in, one shallow spine. Crown scrolls;
/// each row pushes a focused, single-purpose detail. Rows are ≥44 pt, severity
/// paired with an icon + label (never color-only).
struct RootListView: View {
    @EnvironmentObject private var session: WatchSessionStore

    var body: some View {
        List {
            ForEach(RootDestination.allCases) { dest in
                NavigationLink(value: dest) {
                    RootRow(destination: dest)
                }
                .listRowBackground(SMDPalette.surface.color)
            }
        }
        .navigationTitle("StewardMD")
        .navigationDestination(for: RootDestination.self) { dest in
            // Phase 2 replaces these placeholders with the real module views.
            PlaceholderDetail(destination: dest)
        }
        .onAppear { session.reload() }
    }
}

/// The six root modules, in priority order (Critical labs first).
enum RootDestination: String, CaseIterable, Identifiable, Hashable {
    case criticalLabs, patients, wardSync, drugs, calculators, emergency
    var id: String { rawValue }

    var title: String {
        switch self {
        case .criticalLabs: return "Critical labs"
        case .patients: return "My patients"
        case .wardSync: return "Ward Sync"
        case .drugs: return "Drugs & doses"
        case .calculators: return "Calculators"
        case .emergency: return "Emergency"
        }
    }

    var symbol: String {
        switch self {
        case .criticalLabs: return "cross.case.fill"
        case .patients: return "person.2.fill"
        case .wardSync: return "arrow.triangle.2.circlepath"
        case .drugs: return "pills.fill"
        case .calculators: return "function"
        case .emergency: return "cross.circle.fill"
        }
    }

    var accent: SMDColor {
        switch self {
        case .criticalLabs: return SMDPalette.critical
        case .patients: return SMDPalette.teal
        case .wardSync: return SMDPalette.info
        case .drugs: return SMDPalette.ai
        case .calculators: return SMDPalette.success
        case .emergency: return SMDPalette.accent
        }
    }
}

private struct RootRow: View {
    let destination: RootDestination
    var body: some View {
        HStack(spacing: SMDSpacing.m) {
            Image(systemName: destination.symbol)
                .foregroundStyle(destination.accent.color)
                .font(.headline)
            Text(destination.title)
                .foregroundStyle(SMDPalette.text1.color)
            Spacer()
        }
        .frame(minHeight: SMDSpacing.minTapTarget)
    }
}

private struct PlaceholderDetail: View {
    let destination: RootDestination
    var body: some View {
        VStack(spacing: SMDSpacing.s) {
            Image(systemName: destination.symbol)
                .font(.largeTitle)
                .foregroundStyle(destination.accent.color)
            Text(destination.title).font(.headline)
            Text("Coming in the next phase")
                .font(.caption)
                .foregroundStyle(SMDPalette.text2.color)
        }
        .navigationTitle(destination.title)
    }
}
