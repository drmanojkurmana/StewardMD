import Foundation
import Combine
import StewardMDWatchCore

/// Observable session state for the watch UI. Reads the bridged session from the
/// shared App Group (written by the iPhone's WatchBridge plugin) and exposes an
/// `AuthTokenProvider` for the networking layer. Phase 2 adds live WCSession
/// receipt + a token-refresh request; Phase 1 establishes the read path.
@MainActor
final class WatchSessionStore: ObservableObject {
    @Published private(set) var session: Session
    @Published private(set) var favorites: [Favorite]

    private let store: AppGroupStore

    /// Shared networking (single stack in WatchServices).
    var apiClient: APIClient { WatchServices.apiClient }
    var drugAPI: DrugAPI { WatchServices.drugAPI }
    var appAPI: AppAPI { WatchServices.appAPI }

    private var observer: NSObjectProtocol?

    init(store: AppGroupStore = WatchServices.store) {
        self.store = store
        self.session = store.loadSession() ?? .none
        self.favorites = store.loadFavorites()
        // Reload whenever the WatchConnectivity receiver persists fresh data.
        observer = NotificationCenter.default.addObserver(
            forName: .smdWatchDataUpdated, object: nil, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.reload() }
        }
    }

    deinit { if let o = observer { NotificationCenter.default.removeObserver(o) } }

    /// Re-read the shared container (call on `.onAppear` / activation).
    func reload() {
        session = store.loadSession() ?? .none
        favorites = store.loadFavorites()
    }

    var isSignedIn: Bool { session.uid != nil }
    var tokenProvider: AuthTokenProvider { BridgedTokenProvider(store: store) }
}

/// Supplies the current bridged ID token to `APIClient`. Returns nil when the
/// token is missing/expired; the caller then shows cached data or prompts the
/// phone (Phase 2 wires the WCSession refresh round-trip).
struct BridgedTokenProvider: AuthTokenProvider {
    let store: AppGroupStore
    func currentToken() async -> String? {
        if let s = store.loadSession(), s.isValid { return s.idToken }
        // Missing/expired → ask the phone to publish a fresh one; the caller
        // treats this attempt as unauthenticated and retries after the relay.
        await MainActor.run { WatchConnectivityManager.shared.requestToken() }
        return nil
    }
}
