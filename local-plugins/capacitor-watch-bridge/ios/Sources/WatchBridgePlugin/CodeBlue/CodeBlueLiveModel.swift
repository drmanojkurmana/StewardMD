import Foundation
import Combine
import StewardMDWatchCore
#if canImport(WatchConnectivity)
import WatchConnectivity
#endif
#if canImport(ActivityKit)
import ActivityKit
#endif

/// Phone-side live mirror of the watch Code Blue (design §4.2). A singleton so it
/// keeps ingesting + persisting even when the Command Center screen is closed; the
/// SwiftUI views just bind to it. Merges live messages + guaranteed snapshots by
/// event id, ignores stale out-of-order updates, and persists locally only.
@MainActor
final class CodeBlueLiveModel: ObservableObject {
    static let shared = CodeBlueLiveModel()

    @Published private(set) var state: CodeBlueState = .empty
    @Published private(set) var connected = false
    @Published private(set) var lastUpdate: Date?

    private let sync: CodeBlueSyncService
    private let store = CodeBlueLocalStore()
    private var reachTimer: AnyCancellable?

    init(sync: CodeBlueSyncService = WatchConnectivityCodeBlueSync()) {
        self.sync = sync
        if let saved = store.load() { state = saved }
    }

    /// Wire up ingest + reachability. Idempotent; call at plugin load.
    func begin() {
        sync.onState = { [weak self] incoming in self?.ingest(incoming) }
        sync.start()
        // Watch tapped Reset → wipe the phone's records too.
        NotificationCenter.default.addObserver(forName: WatchConnectivityRelay.codeBlueReset,
                                               object: nil, queue: .main) { [weak self] _ in self?.clearLocal() }
        refreshReachability()
        reachTimer = Timer.publish(every: 2, on: .main, in: .common).autoconnect()
            .sink { [weak self] _ in self?.refreshReachability() }
    }

    private func ingest(_ incoming: CodeBlueState) {
        // Ignore stale live messages that would regress a newer snapshot.
        guard incoming.updatedElapsed >= state.updatedElapsed || incoming.events.count >= state.events.count else { return }
        var merged = incoming
        merged.events = mergeEvents(state.events, incoming.events)
        state = merged
        lastUpdate = Date()
        store.save(merged)
        syncLiveActivity()
    }

    // MARK: Live Activity (design §09) — start on running, update per frame, end on ROSC/stop.
    // Stored as Any? because Activity<…> is @available-gated and can't be a plain stored property.
    #if canImport(ActivityKit)
    private var liveActivity: Any?

    private func syncLiveActivity() {
        guard #available(iOS 16.2, *) else { return }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        let content = ActivityContent(state: CodeBlueActivityAttributes.ContentState.from(state), staleDate: nil)
        let running = state.running && !state.rosc
        if running {
            if let act = liveActivity as? Activity<CodeBlueActivityAttributes> {
                Task { await act.update(content) }
            } else {
                liveActivity = try? Activity.request(
                    attributes: CodeBlueActivityAttributes(unit: "Code Blue"),
                    content: content)
            }
        } else if let act = liveActivity as? Activity<CodeBlueActivityAttributes> {
            Task { await act.end(content, dismissalPolicy: .default) }
            liveActivity = nil
        }
    }
    #else
    private func syncLiveActivity() {}
    #endif

    private func refreshReachability() {
        #if canImport(WatchConnectivity)
        connected = WCSession.isSupported() && WCSession.default.isReachable
        #endif
    }

    /// Build a summary from the current local state (for the End screen / export).
    func summary() -> CodeSummary {
        CodeSummary.build(events: state.events, durationSeconds: state.elapsed,
                          cycles: state.cycle, totalCompressions: state.compressionCount,
                          averageRateCPM: state.averageRateCPM, targetRatePct: state.targetRatePct)
    }

    /// Full chronological code record for the chart / export.
    func codeSheetText() -> String {
        let df = DateFormatter(); df.dateFormat = "yyyy-MM-dd HH:mm"
        return summary().codeSheet(events: state.events, header: "Recorded \(df.string(from: Date()))")
    }

    // MARK: Scribe — log events from the phone (design §F2). Each is tagged
    // sourceDeviceId "phone" and merged into the unified timeline by id.
    func logDrug(_ name: String) { logEvent(.drug, name) }
    func logRhythm(_ label: String) { logEvent(.rhythm, label) }
    func logROSC() { logEvent(.rosc, "ROSC") }
    func logShock(energyJ: Int?) {
        let n = state.events.filter { $0.kind == .shock }.count + 1
        logEvent(.shock, "Shock #\(n)" + (energyJ.map { " · \($0)J" } ?? ""))
    }

    private func logEvent(_ kind: CodeEventKind, _ label: String) {
        guard state.running else { return }
        var s = state
        let id = "phone-\(kind.rawValue)-\(UUID().uuidString.prefix(8))"
        let ev = CodeEvent(id: id, elapsed: s.elapsed, kind: kind, label: label, sourceDeviceId: "phone")
        s.events = mergeEvents(s.events, [ev])
        state = s
        lastUpdate = Date()
        store.save(s)
    }

    /// Clear local logs (privacy — offered on sign-out).
    func clearLocal() { store.clear(); state = .empty; lastUpdate = nil; syncLiveActivity() }
}
