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
    /// The clinician's role in the shared unit (relayed) — gates task visibility.
    @Published private(set) var role: String?
    /// Whether the paired iPhone is currently reachable (drives the "not connected"
    /// banner + gates phone-side compute / task write-back).
    @Published private(set) var isReachable: Bool = false
    private let store = WatchServices.store

    func activate() {
        // Seed the UI from the last-known relayed data so it isn't empty on launch.
        WatchServices.watchlist.set(store.loadWatchlist())
        WatchServices.labs.ingest(store.loadCriticals())
        WatchServices.tasks.ingest(store.loadTasks())
        GlancePublisher.setOpenTasks(WatchServices.tasks.openCount)
        WatchServices.tasks.onAction = { [weak self] action in self?.sendTaskAction(action) }
        WatchServices.labs.onAcknowledge = { [weak self] alert in self?.sendLabAck(alert) }
        WatchServices.calcs.set(store.loadCalcs())
        #if canImport(WatchConnectivity)
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
        #endif
    }

    /// Relay a task-status change to the phone (→ SMD_ICU_GROUPS.setTaskStatus).
    /// Uses `transferUserInfo` — guaranteed, FIFO, background delivery even when
    /// the phone app is not foregrounded (unlike `sendMessage`).
    func sendTaskAction(_ action: WatchTaskAction) {
        #if canImport(WatchConnectivity)
        guard WCSession.isSupported() else { return }
        guard let data = try? JSONEncoder().encode(action),
              var info = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return }
        info["kind"] = "taskStatus"
        WCSession.default.transferUserInfo(info)
        #endif
    }

    /// Relay this watch's APNs device token to the phone, which registers it with
    /// the backend (`/api/push/register-native`, platform "watch").
    func sendWatchPushToken(_ token: String) {
        #if canImport(WatchConnectivity)
        guard WCSession.isSupported() else { return }
        WCSession.default.transferUserInfo(["kind": "watchPushToken", "token": token])
        #endif
    }

    /// Relay a critical-lab acknowledge to the phone so it appends an ICU-timeline
    /// event. Only for group-patient criticals (which carry gid/pid); the open/
    /// local patient has no shared doc, so its ack stays the HTTP audit only.
    func sendLabAck(_ alert: LabAlert) {
        #if canImport(WatchConnectivity)
        guard WCSession.isSupported(), let gid = alert.groupId, let pid = alert.patientId,
              !gid.isEmpty, !pid.isEmpty else { return }
        WCSession.default.transferUserInfo([
            "kind": "labAck", "gid": gid, "pid": pid,
            "analyte": alert.analyte, "value": alert.value
        ])
        #endif
    }

    /// Ask the iPhone to compute a relayed calculator (watchOS lacks JavaScriptCore).
    /// Returns a result when the phone is reachable, else a friendly error.
    func computeOnPhone(src: String, values: [String: Any]) async -> CalcOutput {
        #if canImport(WatchConnectivity)
        let s = WCSession.default
        guard WCSession.isSupported(), s.activationState == .activated, s.isReachable else {
            return CalcOutput(value: "—", unit: "", interp: "", error: "Open StewardMD on your iPhone (nearby) to compute this.")
        }
        return await withCheckedContinuation { cont in
            s.sendMessage(["kind": "calcCompute", "src": src, "values": values], replyHandler: { reply in
                if let e = reply["err"] as? String {
                    cont.resume(returning: CalcOutput(value: "—", unit: "", interp: "", error: e))
                } else {
                    cont.resume(returning: CalcOutput(value: reply["v"] as? String ?? "—",
                                                      unit: reply["u"] as? String ?? "",
                                                      interp: reply["i"] as? String ?? "", error: nil))
                }
            }, errorHandler: { _ in
                cont.resume(returning: CalcOutput(value: "—", unit: "", interp: "", error: "Couldn't reach iPhone."))
            })
        }
        #else
        return CalcOutput(value: "—", unit: "", interp: "", error: "unavailable")
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
        if let d = context["criticals"] as? Data, let c = try? JSONDecoder().decode([LabAlert].self, from: d) {
            store.saveCriticals(c)          // persist for relaunch + patient-less syncs
            WatchServices.labs.ingest(c)    // feeds the Critical Labs screen + badge
        }
        if let d = context["tasks"] as? Data, let t = try? JSONDecoder().decode([WatchTask].self, from: d) {
            store.saveTasks(t)          // persist for relaunch + patient-less syncs
            WatchServices.tasks.ingest(t)
            GlancePublisher.setOpenTasks(WatchServices.tasks.openCount)   // Rounds/Tasks glance
        }
        if let s = context["role"] as? String {
            role = s
        }
        if let d = context["calcDefs"] as? Data, let c = try? JSONDecoder().decode([RelayedCalc].self, from: d) {
            store.saveCalcs(c)          // persist favorited calculators for offline use
            WatchServices.calcs.set(c)
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
        let reachable = session.isReachable
        Task { @MainActor in
            self.isReachable = reachable
            if !ctx.isEmpty { self.apply(ctx) }
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        Task { @MainActor in self.apply(applicationContext) }
    }

    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        let reachable = session.isReachable
        Task { @MainActor in self.isReachable = reachable }
    }
}
#endif
