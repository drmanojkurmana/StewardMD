import Foundation
#if canImport(WatchConnectivity)
import WatchConnectivity

/// Owns the phone-side `WCSession` and pushes the latest bridged state to the
/// watch via `updateApplicationContext` (coalesced, latest-wins — ideal for a
/// "current session + favorites" snapshot). No-ops if the paired watch or the
/// framework is unavailable, so it can never block the phone app.
final class WatchConnectivityRelay: NSObject, WCSessionDelegate {
    private var latest: [String: Any] = [:]

    override init() {
        super.init()
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    func updateContext(_ dict: [String: Any]) {
        latest = dict
        guard WCSession.isSupported(),
              WCSession.default.activationState == .activated else { return }
        try? WCSession.default.updateApplicationContext(dict)
    }

    // MARK: WCSessionDelegate
    func session(_ session: WCSession,
                 activationDidCompleteWith activationState: WCSessionActivationState,
                 error: Error?) {
        // Flush any state queued before activation completed.
        if activationState == .activated, !latest.isEmpty {
            try? session.updateApplicationContext(latest)
        }
    }

    func sessionDidBecomeInactive(_ session: WCSession) {}

    func sessionDidDeactivate(_ session: WCSession) {
        // Reactivate for the newly-paired watch (per Apple guidance).
        WCSession.default.activate()
    }

    /// Watch → phone: a request to mint a fresh ID token. Re-broadcast so
    /// `native-watch.js` (listening via the plugin) can publish an update.
    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        NotificationCenter.default.post(name: WatchConnectivityRelay.tokenRequested, object: nil)
    }

    static let tokenRequested = Notification.Name("SMDWatchTokenRequested")
}
#else
/// Non-iOS fallback so the package still compiles everywhere.
final class WatchConnectivityRelay {
    func updateContext(_ dict: [String: Any]) {}
}
#endif
