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
        guard WCSession.isSupported() else { return }
        let s = WCSession.default
        // Queue until the session is activated; the delegate flushes on activation.
        guard s.activationState == .activated else { return }
        try? s.updateApplicationContext(dict)
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

    /// Watch → phone: a task-status change to write back to Firestore. Re-broadcast
    /// so the plugin can hand it to `native-watch.js` (→ SMD_ICU_GROUPS.setTaskStatus).
    /// `transferUserInfo` (used by the watch) is delivered here, guaranteed + FIFO.
    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
        switch userInfo["kind"] as? String {
        case "taskStatus":
            NotificationCenter.default.post(name: WatchConnectivityRelay.taskStatusRequested,
                                            object: nil, userInfo: userInfo)
        case "watchPushToken":
            NotificationCenter.default.post(name: WatchConnectivityRelay.watchTokenReceived,
                                            object: nil, userInfo: userInfo)
        default:
            break
        }
    }

    static let tokenRequested = Notification.Name("SMDWatchTokenRequested")
    static let taskStatusRequested = Notification.Name("SMDWatchTaskStatusRequested")
    static let watchTokenReceived = Notification.Name("SMDWatchPushTokenReceived")
}
#else
/// Non-iOS fallback so the package still compiles everywhere.
final class WatchConnectivityRelay {
    func updateContext(_ dict: [String: Any]) {}
}
#endif
