import Foundation

/// Shared-container persistence for the bridged session and prefs. Backed by an
/// App Group `UserDefaults` suite that both the phone bridge, the watch app, and
/// the WidgetKit extension read/write. Fails safe (no-op) if the suite is absent.
public struct AppGroupStore: Sendable {
    public static let defaultSuite = "group.in.stewardmd.app"

    private let suite: String
    private let sessionKey = "smd.session"
    private let favoritesKey = "smd.favorites"
    private let glanceKey = "smd.glance"
    private let pendingRouteKey = "smd.pendingRoute"

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

    public func saveGlance(_ g: GlanceState) {
        guard let d = defaults, let data = try? JSONEncoder().encode(g) else { return }
        d.set(data, forKey: glanceKey)
    }

    public func loadGlance() -> GlanceState {
        guard let d = defaults, let data = d.data(forKey: glanceKey) else { return .empty }
        return (try? JSONDecoder().decode(GlanceState.self, from: data)) ?? .empty
    }

    /// A deep-link route requested by an App Intent / Siri / Action button, to be
    /// consumed by the app on activation.
    public func savePendingRoute(_ route: String) {
        defaults?.set(route, forKey: pendingRouteKey)
    }
    /// Returns and clears any pending route (consume-once).
    public func takePendingRoute() -> String? {
        guard let d = defaults, let r = d.string(forKey: pendingRouteKey) else { return nil }
        d.removeObject(forKey: pendingRouteKey)
        return r
    }

    public func clear() {
        defaults?.removeObject(forKey: sessionKey)
        defaults?.removeObject(forKey: favoritesKey)
        defaults?.removeObject(forKey: glanceKey)
        defaults?.removeObject(forKey: pendingRouteKey)
    }
}
