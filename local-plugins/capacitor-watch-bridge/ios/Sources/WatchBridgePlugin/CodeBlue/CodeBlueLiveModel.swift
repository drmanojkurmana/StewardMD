import Foundation
import Combine
import StewardMDWatchCore
#if canImport(WatchConnectivity)
import WatchConnectivity
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
    }

    private func refreshReachability() {
        #if canImport(WatchConnectivity)
        connected = WCSession.isSupported() && WCSession.default.isReachable
        #endif
    }

    /// Build a summary from the current local state (for the End screen / export).
    func summary() -> CodeSummary {
        CodeSummary.build(events: state.events, durationSeconds: state.elapsed,
                          cycles: state.cycle, totalCompressions: state.compressionCount,
                          averageRateCPM: state.averageRateCPM)
    }

    /// Clear local logs (privacy — offered on sign-out).
    func clearLocal() { store.clear(); state = .empty; lastUpdate = nil }
}
