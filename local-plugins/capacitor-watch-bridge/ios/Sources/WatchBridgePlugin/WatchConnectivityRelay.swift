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
        guard WCSession.isSupported() else { NSLog("[SMD-Watch] WCSession not supported"); return }
        let s = WCSession.default
        // DIAGNOSTIC (systematic-debugging evidence): the delivery boundary state.
        NSLog("[SMD-Watch] relay: activation=%ld paired=%d watchAppInstalled=%d reachable=%d keys=[%@]",
              s.activationState.rawValue, s.isPaired, s.isWatchAppInstalled, s.isReachable,
              dict.keys.sorted().joined(separator: ","))
        guard s.activationState == .activated else {
            NSLog("[SMD-Watch] relay: session not activated yet — queued, will flush on activation")
            return
        }
        do {
            try s.updateApplicationContext(dict)
            NSLog("[SMD-Watch] relay: updateApplicationContext OK")
        } catch {
            NSLog("[SMD-Watch] relay: updateApplicationContext FAILED: %@", String(describing: error))
        }
    }

    // MARK: WCSessionDelegate
    func session(_ session: WCSession,
                 activationDidCompleteWith activationState: WCSessionActivationState,
                 error: Error?) {
        NSLog("[SMD-Watch] relay: activationDidComplete state=%ld error=%@ hasQueued=%d",
              activationState.rawValue, error.map { String(describing: $0) } ?? "nil", latest.isEmpty ? 0 : 1)
        // Flush any state queued before activation completed.
        if activationState == .activated, !latest.isEmpty {
            do { try session.updateApplicationContext(latest); NSLog("[SMD-Watch] relay: queued flush OK") }
            catch { NSLog("[SMD-Watch] relay: queued flush FAILED: %@", String(describing: error)) }
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
