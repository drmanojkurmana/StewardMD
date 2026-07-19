import Foundation

/// Shared-container persistence for the bridged session and prefs. Backed by an
/// App Group `UserDefaults` suite that both the phone bridge, the watch app, and
/// the WidgetKit extension read/write. Fails safe (no-op) if the suite is absent.
public struct AppGroupStore: Sendable {
    public static let defaultSuite = "group.in.stewardmd.app"

    private let suite: String
    private let sessionKey = "smd.session"
    private let favoritesKey = "smd.favorites"

    public init(suite: String = AppGroupStore.defaultSuite) { self.suite = suite }

    private var defaults: UserDefaults? { UserDefaults(suiteName: suite) }

    public func saveSession(_ s: Session) {
        guard let d = defaults, let data = try? JSONEncoder().encode(s) else { return }
        d.set(data, forKey: sessionKey)
    }

    public func loadSession() -> Session? {
        guard let d = defaults, let data = d.data(forKey: sessionKey) else { return nil }
        return try? JSONDecoder().decode(Session.self, from: data)
    }

    public func saveFavorites(_ favs: [Favorite]) {
        guard let d = defaults, let data = try? JSONEncoder().encode(favs) else { return }
        d.set(data, forKey: favoritesKey)
    }

    public func loadFavorites() -> [Favorite] {
        guard let d = defaults, let data = d.data(forKey: favoritesKey) else { return [] }
        return (try? JSONDecoder().decode([Favorite].self, from: data)) ?? []
    }

    public func clear() {
        defaults?.removeObject(forKey: sessionKey)
        defaults?.removeObject(forKey: favoritesKey)
    }
}
