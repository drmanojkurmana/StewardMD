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

    init(store: AppGroupStore = AppGroupStore()) {
        self.store = store
        self.session = store.loadSession() ?? .none
        self.favorites = store.loadFavorites()
    }

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
        guard let s = store.loadSession(), s.isValid else { return nil }
        return s.idToken
    }
}
