import SwiftUI
import UserNotifications
import StewardMDWatchCore

/// Schedules local notifications for resus timers so their alerts fire even with
/// the wrist down / app backgrounded (a foreground-only `Timer` can't). The in-app
/// haptics still play when frontmost; these are the belt-and-braces background copy.
enum ResusAlerts {
    static func requestAuth() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }
    static func schedule(id: String, after seconds: TimeInterval, title: String, body: String, repeats: Bool = false) {
        guard seconds > 0 else { return }
        let c = UNMutableNotificationContent()
        c.title = title; c.body = body; c.sound = .default
        let t = UNTimeIntervalNotificationTrigger(timeInterval: seconds, repeats: repeats)
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: c, trigger: t))
    }
    static func cancel(_ ids: [String]) {
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: ids)
    }
}

/// Root / Home (design §04 IA + §05 "Home · Today"): a greeting + on-call context
/// header, then the six-way vertical spine. Crown scrolls; each row pushes a
/// focused detail. Critical labs carries a live unacknowledged badge.
struct RootListView: View {
    @EnvironmentObject private var session: WatchSessionStore
    @EnvironmentObject private var labs: CriticalLabsModel
    @EnvironmentObject private var tasksModel: TasksModel
    @EnvironmentObject private var features: FeatureFlagsModel

    var body: some View {
        List {
            Section {
                HomeHeader()
                    .listRowBackground(Color.clear)
                    // Align the header's leading edge with the module rows below.
                    .listRowInsets(EdgeInsets(top: SMDSpacing.s, leading: SMDSpacing.m,
                                              bottom: SMDSpacing.s, trailing: SMDSpacing.m))
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
                            badge: dest == .criticalLabs ? labs.unacknowledgedCount
                                 : dest == .tasks ? tasksModel.openCount : 0,
                            locked: locked)
                }
                .disabled(locked)
                .listRowBackground(SMDPalette.surface.color)
            }
        }
        // Empty nav title: HomeHeader is the sole wordmark (avoids the duplicate title).
        .navigationTitle("")
        .navigationDestination(for: RootDestination.self) { dest in
            switch dest {
            case .criticalLabs: CriticalLabsView()
            case .patients: WatchlistView()
            case .tasks: TasksView()
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

/// A thin amber bar shown on phone-tethered screens when the iPhone isn't
/// reachable, so an empty list reads as "out of range" — not "no data". Renders
/// nothing when connected.
struct ConnectivityBanner: View {
    @ObservedObject private var conn = WatchConnectivityManager.shared
    var body: some View {
        if !conn.isReachable {
            HStack(spacing: 5) {
                Image(systemName: "iphone.slash").font(.system(size: 11))
                Text("iPhone not connected").font(.caption2)
            }
            .foregroundStyle(SMDPalette.warning.color)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 3)
            .background(SMDPalette.warning.color.opacity(0.18))
            .accessibilityLabel("iPhone not connected — data may be out of date")
        }
    }
}

/// The six root modules, in priority order (Critical labs first).
enum RootDestination: String, CaseIterable, Identifiable, Hashable {
    case criticalLabs, patients, tasks, wardSync, drugs, calculators, emergency
    var id: String { rawValue }

    var title: String {
        switch self {
        case .criticalLabs: return "Critical labs"
        case .patients: return "My patients"
        case .tasks: return "Tasks"
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
        case .tasks: return "checklist"
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
        case .tasks: return SMDPalette.accent
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
        case .patients, .tasks, .emergency: return nil
        }
    }
}

private struct HomeHeader: View {
    @EnvironmentObject private var session: WatchSessionStore

    var body: some View {
        // StewardMD wordmark on top; the signed-in doctor's name below it. The module
        // menu (RootRow list) scrolls below this header.
        let raw = session.session.doctorName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let doctor = raw.isEmpty ? "" : (raw.lowercased().hasPrefix("dr") ? raw : "Dr. " + raw)
        VStack(alignment: .leading, spacing: 2) {
            Text("StewardMD")
                .font(.system(.headline, design: .rounded)).bold()
                .foregroundStyle(SMDPalette.accent.color)
            if !doctor.isEmpty {
                Text(doctor)
                    .font(.caption2)
                    .foregroundStyle(SMDPalette.text2.color)
            }
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

