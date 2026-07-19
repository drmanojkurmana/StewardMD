import Foundation
import Capacitor

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

        let sessionData = try? JSONSerialization.data(withJSONObject: session)
        let favData = try? JSONSerialization.data(withJSONObject: favorites)
        let recentsData = try? JSONSerialization.data(withJSONObject: recents)

        if let d = UserDefaults(suiteName: suiteName) {
            d.set(sessionData, forKey: sessionKey)
            d.set(favData, forKey: favoritesKey)
            d.set(recentsData, forKey: recentsKey)
        }

        var context: [String: Any] = [:]
        if let s = sessionData { context["session"] = s }
        if let f = favData { context["favorites"] = f }
        if let r = recentsData { context["recents"] = r }
        relay.updateContext(context)

        call.resolve()
    }

    @objc func clear(_ call: CAPPluginCall) {
        if let d = UserDefaults(suiteName: suiteName) {
            d.removeObject(forKey: sessionKey)
            d.removeObject(forKey: favoritesKey)
            d.removeObject(forKey: recentsKey)
        }
        relay.updateContext(["cleared": true])
        call.resolve()
    }
}
