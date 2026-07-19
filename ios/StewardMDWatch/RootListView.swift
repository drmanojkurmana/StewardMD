import SwiftUI
import StewardMDWatchCore

/// Root / Home (design §04 IA + §05 "Home · Today"): a greeting + on-call context
/// header, then the six-way vertical spine. Crown scrolls; each row pushes a
/// focused detail. Critical labs carries a live unacknowledged badge.
struct RootListView: View {
    @EnvironmentObject private var session: WatchSessionStore
    @EnvironmentObject private var labs: CriticalLabsModel
    @EnvironmentObject private var features: FeatureFlagsModel

    var body: some View {
        List {
            Section {
                HomeHeader()
                    .listRowBackground(Color.clear)
            }
            if let msg = features.announcement {
                Text(msg)
                    .font(.caption2)
                    .foregroundStyle(SMDPalette.text1.color)
                    .padding(SMDSpacing.s)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(SMDPalette.ai.color.opacity(0.25), in: RoundedRectangle(cornerRadius: SMDSpacing.radiusChip))
                    .listRowBackground(Color.clear)
            }
            ForEach(RootDestination.allCases) { dest in
                let locked = dest.feature.map { !features.gate.allows($0) } ?? false
                NavigationLink(value: dest) {
                    RootRow(destination: dest,
                            badge: dest == .criticalLabs ? labs.unacknowledgedCount : 0,
                            locked: locked)
                }
                .disabled(locked)
                .listRowBackground(SMDPalette.surface.color)
            }
        }
        .navigationTitle("StewardMD")
        .navigationDestination(for: RootDestination.self) { dest in
            switch dest {
            case .criticalLabs: CriticalLabsView()
            case .patients: WatchlistView()
            case .wardSync: WardSyncView()
            case .drugs: DrugLookupView()
            case .calculators: CalculatorsView()
            case .emergency: EmergencyView()
            }
        }
        .navigationDestination(for: LabAlert.self) { LabDetailView(alert: $0) }
        .navigationDestination(for: EmergencyRoute.self) { route in
            switch route {
            case .codeBlue: CodeBlueView()
            case .sepsis: SepsisTimerView()
            case .abg: ABGView()
            case .procedure: ProcedureTimerView()
            }
        }
        .navigationDestination(for: CalcRoute.self) { CalculatorDetailView(id: $0.id) }
        .navigationDestination(for: WatchlistEntry.self) { PatientGlanceView(entry: $0) }
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

    /// The gateable feature backing this row, if any (patients / emergency are
    /// always available).
    var feature: WatchFeature? {
        switch self {
        case .criticalLabs: return .criticalLabs
        case .wardSync: return .wardSync
        case .drugs: return .drugLookup
        case .calculators: return .calculators
        case .patients, .emergency: return nil
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
    var locked: Bool = false
    var body: some View {
        HStack(spacing: SMDSpacing.m) {
            Image(systemName: destination.symbol)
                .foregroundStyle(locked ? SMDPalette.text2.color : destination.accent.color)
                .font(.headline)
            Text(destination.title)
                .foregroundStyle(locked ? SMDPalette.text2.color : SMDPalette.text1.color)
            Spacer()
            if locked {
                Image(systemName: "lock.fill")
                    .font(.caption2).foregroundStyle(SMDPalette.text2.color)
            } else if badge > 0 {
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

