import Foundation
#if canImport(JavaScriptCore)
import JavaScriptCore
#endif
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
    /// Watch → phone with a reply: run a relayed calculator's compute on the
    /// phone (iOS HAS JavaScriptCore; watchOS does NOT) and reply {v,u,i}/{err}.
    func session(_ session: WCSession, didReceiveMessage message: [String: Any],
                 replyHandler: @escaping ([String: Any]) -> Void) {
        guard (message["kind"] as? String) == "calcCompute", let src = message["src"] as? String else {
            replyHandler(["err": "bad-request"]); return
        }
        let values = (message["values"] as? [String: Any]) ?? [:]
        replyHandler(WatchConnectivityRelay.evalCalc(src: src, values: values))
    }

    /// Evaluate a compute(v) source with the calculators.js helper set, returning
    /// a plist-safe `{v,u,i}` (interp HTML stripped) or `{err}`.
    static func evalCalc(src: String, values: [String: Any]) -> [String: Any] {
        #if canImport(JavaScriptCore)
        guard let ctx = JSContext() else { return ["err": "no-js"] }
        ctx.evaluateScript(calcHelpers)
        ctx.setObject(values as NSDictionary, forKeyedSubscript: "__v" as NSString)
        ctx.exception = nil
        guard let r = ctx.evaluateScript("(\(src))(__v)"), ctx.exception == nil, !r.isUndefined, !r.isNull else {
            return ["err": "Couldn't compute."]
        }
        if let e = r.objectForKeyedSubscript("err"), !e.isUndefined, !e.isNull {
            return ["err": e.toString() ?? "Enter all required values."]
        }
        var out: [String: Any] = [:]
        if let v = r.objectForKeyedSubscript("v"), !v.isUndefined, !v.isNull { out["v"] = v.toString() ?? "" }
        if let u = r.objectForKeyedSubscript("u"), !u.isUndefined, !u.isNull { out["u"] = u.toString() ?? "" }
        if let i = r.objectForKeyedSubscript("i"), !i.isUndefined, !i.isNull { out["i"] = stripHTML(i.toString() ?? "") }
        return out
        #else
        return ["err": "no-js"]
        #endif
    }

    private static func stripHTML(_ s: String) -> String {
        var out = "", inTag = false
        for ch in s { if ch == "<" { inTag = true } else if ch == ">" { inTag = false } else if !inTag { out.append(ch) } }
        return out.replacingOccurrences(of: "&lt;", with: "<").replacingOccurrences(of: "&gt;", with: ">")
                  .replacingOccurrences(of: "&amp;", with: "&").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static let calcHelpers = """
    function ok(x){return typeof x==='number'&&!isNaN(x)&&isFinite(x);}
    function ln(x){return Math.log(x);}
    function r1(x){return Math.round(x*10)/10;}
    function r0(x){return Math.round(x);}
    function band(score,bands){for(var i=0;i<bands.length;i++)if(score<=bands[i][0])return bands[i][1];return bands[bands.length-1][1];}
    var ERR={err:'Enter all required values.'};
    """

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
        switch userInfo["kind"] as? String {
        case "taskStatus":
            NotificationCenter.default.post(name: WatchConnectivityRelay.taskStatusRequested,
                                            object: nil, userInfo: userInfo)
        case "watchPushToken":
            NotificationCenter.default.post(name: WatchConnectivityRelay.watchTokenReceived,
                                            object: nil, userInfo: userInfo)
        case "labAck":
            NotificationCenter.default.post(name: WatchConnectivityRelay.labAckRequested,
                                            object: nil, userInfo: userInfo)
        default:
            break
        }
    }

    static let tokenRequested = Notification.Name("SMDWatchTokenRequested")
    static let taskStatusRequested = Notification.Name("SMDWatchTaskStatusRequested")
    static let watchTokenReceived = Notification.Name("SMDWatchPushTokenReceived")
    static let labAckRequested = Notification.Name("SMDWatchLabAckRequested")
}
#else
/// Non-iOS fallback so the package still compiles everywhere.
final class WatchConnectivityRelay {
    func updateContext(_ dict: [String: Any]) {}
}
#endif
