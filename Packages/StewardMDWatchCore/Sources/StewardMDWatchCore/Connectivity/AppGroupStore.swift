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
    private let watchlistKey = "smd.watchlist"
    private let criticalsKey = "smd.criticals"
    private let notifPrefsKey = "smd.notifPrefs"
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

    /// The patient watchlist relayed from the iPhone (survives relaunch; also
    /// readable by the widget extension).
    public func saveWatchlist(_ entries: [WatchlistEntry]) {
        guard let d = defaults, let data = try? JSONEncoder().encode(entries) else { return }
        d.set(data, forKey: watchlistKey)
    }
    public func loadWatchlist() -> [WatchlistEntry] {
        guard let d = defaults, let data = d.data(forKey: watchlistKey) else { return [] }
        return (try? JSONDecoder().decode([WatchlistEntry].self, from: data)) ?? []
    }

    /// The critical-lab alerts relayed from the iPhone. Persisted (like the
    /// watchlist) so the Critical Labs screen survives relaunch and a later
    /// patient-less sync — the relay only includes `criticals` while an ICU
    /// patient is open, so without this they'd vanish on the next publish.
    public func saveCriticals(_ alerts: [LabAlert]) {
        guard let d = defaults, let data = try? JSONEncoder().encode(alerts) else { return }
        d.set(data, forKey: criticalsKey)
    }
    public func loadCriticals() -> [LabAlert] {
        guard let d = defaults, let data = d.data(forKey: criticalsKey) else { return [] }
        return (try? JSONDecoder().decode([LabAlert].self, from: data)) ?? []
    }

    /// Notification-tier preferences relayed from the iPhone (critical/warning/info).
    public func saveNotifPrefs(_ prefs: [String: Bool]) {
        guard let d = defaults, let data = try? JSONEncoder().encode(prefs) else { return }
        d.set(data, forKey: notifPrefsKey)
    }
    public func loadNotifPrefs() -> [String: Bool] {
        guard let d = defaults, let data = d.data(forKey: notifPrefsKey) else {
            return ["critical": true, "warning": true, "info": false]
        }
        return (try? JSONDecoder().decode([String: Bool].self, from: data))
            ?? ["critical": true, "warning": true, "info": false]
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

    private var pendingDrugKey: String { "smd.pendingDrug" }
    /// A drug query requested by Siri ("<drug> dose"), consumed once by the lookup screen.
    public func savePendingDrug(_ q: String) { defaults?.set(q, forKey: pendingDrugKey) }
    public func takePendingDrug() -> String? {
        guard let d = defaults, let q = d.string(forKey: pendingDrugKey) else { return nil }
        d.removeObject(forKey: pendingDrugKey)
        return q
    }

    public func clear() {
        defaults?.removeObject(forKey: sessionKey)
        defaults?.removeObject(forKey: favoritesKey)
        defaults?.removeObject(forKey: glanceKey)
        defaults?.removeObject(forKey: watchlistKey)
        defaults?.removeObject(forKey: criticalsKey)
        defaults?.removeObject(forKey: notifPrefsKey)
        defaults?.removeObject(forKey: pendingRouteKey)
    }
}
