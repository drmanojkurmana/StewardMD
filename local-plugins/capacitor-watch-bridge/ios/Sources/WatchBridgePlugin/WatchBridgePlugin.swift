import Foundation
import Capacitor
#if canImport(WatchConnectivity)
import WatchConnectivity
#endif

/**
 * WatchBridge — publishes the signed-in session and favorites/recents to the
 * paired Apple Watch (StewardMD watchOS app + widgets).
 *
 * Exposed to JS as `Capacitor.Plugins.WatchBridge.publish({...})` / `.clear()`.
 * Called only from `native-watch.js`, which is `SMD_IS_NATIVE`-gated and no-ops
 * on the web build — so this plugin never affects the existing web/native flows.
 *
 * Transport is dual, for reliability:
 *   1. Shared App Group `UserDefaults` (group.in.stewardmd.app) — read by the
 *      watch app AND the WidgetKit extension. Persists across launches.
 *   2. `WCSession.updateApplicationContext` — pushes the latest state to the
 *      watch immediately when it is reachable (coalesced, latest-wins).
 *
 * Keys written to the App Group match `AppGroupStore` in StewardMDWatchCore
 * ("smd.session", "smd.favorites") so the watch decodes them directly.
 */
@objc(WatchBridgePlugin)
public class WatchBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WatchBridgePlugin"
    public let jsName = "WatchBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "publish", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise)
    ]

    private let suiteName = "group.in.stewardmd.app"
    private let sessionKey = "smd.session"
    private let favoritesKey = "smd.favorites"
    private let recentsKey = "smd.recents"
    private let notifPrefsKey = "smd.notifPrefs"
    private let glanceKey = "smd.glance"
    private let watchlistKey = "smd.watchlist"
    private let criticalsKey = "smd.criticals"
    private let tasksKey = "smd.tasks"

    private lazy var relay = WatchConnectivityRelay()

    override public func load() {
        // Force the WCSession to activate at plugin load so getStatus() is reliable.
        _ = relay
        // When the watch asks for a fresh token, re-emit to JS so native-watch.js
        // republishes. Decoupled via a string-keyed notification (same pattern as
        // AppOrientationPlugin) so the plugin owns no cross-module symbols.
        #if canImport(WatchConnectivity)
        NotificationCenter.default.addObserver(
            forName: WatchConnectivityRelay.tokenRequested, object: nil, queue: .main
        ) { [weak self] _ in
            self?.notifyListeners("tokenRequested", data: [:])
        }
        // Watch → phone task-status write-back → JS (SMD_ICU_GROUPS.setTaskStatus).
        NotificationCenter.default.addObserver(
            forName: WatchConnectivityRelay.taskStatusRequested, object: nil, queue: .main
        ) { [weak self] note in
            self?.notifyListeners("taskStatus", data: (note.userInfo as? [String: Any]) ?? [:])
        }
        #endif
    }

    /// Live WCSession state for the Settings → Apple Watch page (auto-detects
    /// pairing). iOS-only properties; on any other platform returns supported:false.
    @objc func getStatus(_ call: CAPPluginCall) {
        #if canImport(WatchConnectivity)
        guard WCSession.isSupported() else { call.resolve(["supported": false]); return }
        let s = WCSession.default
        call.resolve([
            "supported": true,
            "paired": s.isPaired,
            "watchAppInstalled": s.isWatchAppInstalled,
            "complicationEnabled": s.isComplicationEnabled,
            "reachable": s.isReachable,
            "activationState": s.activationState.rawValue
        ])
        #else
        call.resolve(["supported": false])
        #endif
    }

    @objc func publish(_ call: CAPPluginCall) {
        // Session — encode {uid, idToken, expiresAt} exactly as StewardMDWatchCore.Session.
        var session: [String: Any] = [:]
        if let uid = call.getString("uid") { session["uid"] = uid }
        if let token = call.getString("idToken") { session["idToken"] = token }
        if let exp = call.getDouble("expiresAt") { session["expiresAt"] = exp }

        // JSArray elements are already JSON-compatible (String/NSNumber/NSNull/…).
        let favorites: [Any] = call.getArray("favorites") ?? []
        let recents: [Any] = call.getArray("recents") ?? []
        let notifPrefs = call.getObject("notifPrefs")
        // glance (census/counts) + watchlist are OPTIONAL — only forwarded when the
        // caller provides them, so a session-only publish never wipes the watch's
        // last-known census/patient list.
        let glance = call.getObject("glance")
        let watchlist = call.getArray("watchlist")
        let criticals = call.getArray("criticals")
        let tasks = call.getArray("tasks")
        let role = call.getString("role")

        let sessionData = try? JSONSerialization.data(withJSONObject: session)
        let favData = try? JSONSerialization.data(withJSONObject: favorites)
        let recentsData = try? JSONSerialization.data(withJSONObject: recents)
        let notifData = notifPrefs.flatMap { try? JSONSerialization.data(withJSONObject: $0) }
        let glanceData = glance.flatMap { try? JSONSerialization.data(withJSONObject: $0) }
        let watchlistData = watchlist.flatMap { try? JSONSerialization.data(withJSONObject: $0) }
        let criticalsData = criticals.flatMap { try? JSONSerialization.data(withJSONObject: $0) }
        let tasksData = tasks.flatMap { try? JSONSerialization.data(withJSONObject: $0) }

        if let d = UserDefaults(suiteName: suiteName) {
            d.set(sessionData, forKey: sessionKey)
            d.set(favData, forKey: favoritesKey)
            d.set(recentsData, forKey: recentsKey)
            if let n = notifData { d.set(n, forKey: notifPrefsKey) }
            if let g = glanceData { d.set(g, forKey: glanceKey) }
            if let w = watchlistData { d.set(w, forKey: watchlistKey) }
            if let c = criticalsData { d.set(c, forKey: criticalsKey) }
            if let t = tasksData { d.set(t, forKey: tasksKey) }
        }

        var context: [String: Any] = [:]
        if let s = sessionData { context["session"] = s }
        if let f = favData { context["favorites"] = f }
        if let r = recentsData { context["recents"] = r }
        if let n = notifData { context["notifPrefs"] = n }
        if let g = glanceData { context["glance"] = g }
        if let w = watchlistData { context["watchlist"] = w }
        if let c = criticalsData { context["criticals"] = c }
        if let t = tasksData { context["tasks"] = t }
        if let r = role { context["role"] = r }

        // DIAGNOSTIC (systematic-debugging evidence): what the phone is publishing.
        NSLog("[SMD-Watch] publish uid=%@ favs=%d recents=%d glance=%@ watchlist=%d criticals=%d",
              (session["uid"] as? String) != nil ? "set" : "nil",
              favorites.count, recents.count,
              glance == nil ? "nil" : "set", watchlist?.count ?? -1, criticals?.count ?? -1)

        relay.updateContext(context)

        call.resolve()
    }

    @objc func clear(_ call: CAPPluginCall) {
        if let d = UserDefaults(suiteName: suiteName) {
            d.removeObject(forKey: sessionKey)
            d.removeObject(forKey: favoritesKey)
            d.removeObject(forKey: recentsKey)
            d.removeObject(forKey: notifPrefsKey)
            d.removeObject(forKey: glanceKey)
            d.removeObject(forKey: watchlistKey)
            d.removeObject(forKey: criticalsKey)
            d.removeObject(forKey: tasksKey)
        }
        relay.updateContext(["cleared": true])
        call.resolve()
    }
}
