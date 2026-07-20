import Foundation
import Combine
import StewardMDWatchCore
#if canImport(WatchConnectivity)
import WatchConnectivity
#endif

/// The WATCH-SIDE WatchConnectivity receiver — the other half of the bridge.
///
/// App Group `UserDefaults` is per-device and does NOT cross the iPhone↔Watch
/// boundary, so the ONLY transport is WatchConnectivity. The iPhone plugin sends
/// the session/favorites/relayed-state via `updateApplicationContext`; this
/// receives it, persists into the WATCH's own App Group (so the watch app + its
/// widgets can read it), and refreshes the UI. It can also ask the phone for a
/// fresh Firebase token when the current one is missing/expired.
@MainActor
final class WatchConnectivityManager: NSObject, ObservableObject {
    static let shared = WatchConnectivityManager()

    @Published private(set) var lastReceived: Date?
    private let store = WatchServices.store

    func activate() {
        // Seed the UI from the last-known relayed data so it isn't empty on launch.
        WatchServices.watchlist.set(store.loadWatchlist())
        WatchServices.labs.ingest(store.loadCriticals())
        #if canImport(WatchConnectivity)
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
        #endif
    }

    /// Ask the paired iPhone to mint + publish a fresh ID token.
    func requestToken() {
        #if canImport(WatchConnectivity)
        let s = WCSession.default
        guard s.activationState == .activated, s.isReachable else { return }
        s.sendMessage(["kind": WCMessageKind.tokenRequest.rawValue], replyHandler: nil, errorHandler: nil)
        #endif
    }

    /// Decode a received context and fan it out to the App Group + shared models.
    fileprivate func apply(_ context: [String: Any]) {
        // DIAGNOSTIC (systematic-debugging evidence): what the watch received.
        let wl = (context["watchlist"] as? Data).flatMap { try? JSONDecoder().decode([WatchlistEntry].self, from: $0) }
        NSLog("[SMD-Watch] watch apply: keys=[%@] watchlist=%d glance=%@ criticalsKey=%@",
              context.keys.sorted().joined(separator: ","),
              wl?.count ?? -1, context["glance"] == nil ? "nil" : "set",
              context["criticals"] == nil ? "nil" : "present")
        if context["cleared"] as? Bool == true {
            store.clear()
            broadcast()
            return
        }
        if let d = context["session"] as? Data, let s = try? JSONDecoder().decode(Session.self, from: d) {
            store.saveSession(s)
        }
        if let d = context["favorites"] as? Data, let f = try? JSONDecoder().decode([Favorite].self, from: d) {
            store.saveFavorites(f)
        }
        // Merge phone-owned census fields into the stored glance — never clobber
        // the watch-owned critical count/badge (which is push-driven).
        if let d = context["glance"] as? Data,
           let dict = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] {
            store.saveGlance(store.loadGlance().merged(with: dict))
        }
        if let d = context["watchlist"] as? Data, let w = try? JSONDecoder().decode([WatchlistEntry].self, from: d) {
            store.saveWatchlist(w)          // persist for relaunch + the widget
            WatchServices.watchlist.set(w)
        }
        if let d = context["criticals"] as? Data {
            do {
                let c = try JSONDecoder().decode([LabAlert].self, from: d)
                store.saveCriticals(c)          // persist for relaunch + patient-less syncs
                WatchServices.labs.ingest(c)    // feeds the Critical Labs screen + badge
                NSLog("[SMD-Watch] watch apply: criticals decoded=%d ingested; labs now=%d",
                      c.count, WatchServices.labs.labs.count)
            } catch {
                NSLog("[SMD-Watch] watch apply: criticals DECODE FAILED: %@ raw=%@",
                      String(describing: error), String(data: d, encoding: .utf8) ?? "nil")
            }
        }
        if let d = context["notifPrefs"] as? Data, let p = try? JSONDecoder().decode([String: Bool].self, from: d) {
            store.saveNotifPrefs(p)
        }
        lastReceived = Date()
        broadcast()
    }

    private func broadcast() {
        NotificationCenter.default.post(name: .smdWatchDataUpdated, object: nil)
    }
}

extension Notification.Name {
    /// Posted when bridged data (session/favorites/glance) is received or cleared.
    static let smdWatchDataUpdated = Notification.Name("smdWatchDataUpdated")
}

#if canImport(WatchConnectivity)
extension WatchConnectivityManager: WCSessionDelegate {
    // Delegate callbacks arrive off the main actor → hop back on.
    nonisolated func session(_ session: WCSession,
                             activationDidCompleteWith activationState: WCSessionActivationState,
                             error: Error?) {
        let ctx = session.receivedApplicationContext   // latest, even if sent pre-activation
        Task { @MainActor in if !ctx.isEmpty { self.apply(ctx) } }
    }

    nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        Task { @MainActor in self.apply(applicationContext) }
    }
}
#endif
