import SwiftUI
import StewardMDWatchCore

/// Root / Home (design §04 IA + §05 "Home · Today"): a greeting + on-call context
/// header, then the six-way vertical spine. Crown scrolls; each row pushes a
/// focused detail. Critical labs carries a live unacknowledged badge.
struct RootListView: View {
    @EnvironmentObject private var session: WatchSessionStore
    @EnvironmentObject private var labs: CriticalLabsModel

    var body: some View {
        List {
            Section {
                HomeHeader()
                    .listRowBackground(Color.clear)
            }
            ForEach(RootDestination.allCases) { dest in
                NavigationLink(value: dest) {
                    RootRow(destination: dest,
                            badge: dest == .criticalLabs ? labs.unacknowledgedCount : 0)
                }
                .listRowBackground(SMDPalette.surface.color)
            }
        }
        .navigationTitle("StewardMD")
        .navigationDestination(for: RootDestination.self) { dest in
            switch dest {
            case .criticalLabs: CriticalLabsView()
            case .drugs: DrugLookupView()
            case .emergency: EmergencyView()
            case .patients, .wardSync, .calculators:
                ComingSoonDetail(destination: dest)   // delivered in later phases
            }
        }
        .onAppear {
            session.reload()
            publishGlance()
        }
        .onChange(of: labs.unacknowledgedCount) { _, _ in publishGlance() }
    }

    private func publishGlance() {
        let top = labs.labs.first { !labs.isAcknowledged($0.id) }
        GlancePublisher.setCritical(
            count: labs.unacknowledgedCount,
            top: top.map { "\($0.analyte) \($0.value)" }
        )
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

private struct HomeHeader: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("StewardMD")
                .font(.system(.headline, design: .rounded)).bold()
                .foregroundStyle(SMDPalette.accent.color)
            Text("On call · Ward 7")
                .font(.caption2)
                .foregroundStyle(SMDPalette.text2.color)
        }
    }
}

private struct RootRow: View {
    let destination: RootDestination
    let badge: Int
    var body: some View {
        HStack(spacing: SMDSpacing.m) {
            Image(systemName: destination.symbol)
                .foregroundStyle(destination.accent.color)
                .font(.headline)
            Text(destination.title)
                .foregroundStyle(SMDPalette.text1.color)
            Spacer()
            if badge > 0 {
                Text("\(badge)")
                    .font(.caption2).bold()
                    .padding(.horizontal, 7).padding(.vertical, 2)
                    .background(SMDPalette.critical.color, in: Capsule())
                    .foregroundStyle(.white)
            }
        }
        .frame(minHeight: SMDSpacing.minTapTarget)
    }
}

private struct ComingSoonDetail: View {
    let destination: RootDestination
    var body: some View {
        VStack(spacing: SMDSpacing.s) {
            Image(systemName: destination.symbol)
                .font(.largeTitle).foregroundStyle(destination.accent.color)
            Text(destination.title).font(.headline)
            Text("Coming in the next phase")
                .font(.caption).foregroundStyle(SMDPalette.text2.color)
        }
        .navigationTitle(destination.title)
    }
}
