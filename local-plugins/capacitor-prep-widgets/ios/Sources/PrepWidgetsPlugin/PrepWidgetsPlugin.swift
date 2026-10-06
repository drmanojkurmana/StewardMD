import Foundation
import Capacitor
import WidgetKit
import ActivityKit
import StewardMDWatchCore

/**
 * PrepNucleus widgets + Live Activity (iOS). Exposed to JS as `Capacitor.Plugins.PrepWidgets`.
 *
 *  - setData({data})        writes the JSON string to App Group UserDefaults `prep.widget` and reloads
 *                           the `StewardMDPrep` widget timelines. Resolves {}.
 *  - activityStatus()       {supported, enabled, active}.
 *  - startActivity({data})  starts the Live Activity, or updates the running one (idempotent).
 *  - updateActivity({data}) updates the running one; starts it if none is running.
 *  - endActivity()          ends every prep activity with immediate dismissal.
 * Start/update resolve {started:false, reason} instead of rejecting: "unsupported" (below iOS 16.2),
 * "disabled" (Live Activities off in Settings), "invalid" (data did not parse), or the ActivityKit error.
 * The content goes stale at the end of the local day (staleDate), so the Lock Screen never shows
 * yesterday's plan as current.
 */
@objc(PrepWidgetsPlugin)
public class PrepWidgetsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PrepWidgetsPlugin"
    public let jsName = "PrepWidgets"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setData", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "activityStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startActivity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateActivity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endActivity", returnType: CAPPluginReturnPromise)
    ]

    @objc func setData(_ call: CAPPluginCall) {
        guard let data = call.getString("data") else {
            call.reject("data (JSON string) is required")
            return
        }
        UserDefaults(suiteName: PrepSnapshot.appGroup)?.set(data, forKey: PrepSnapshot.defaultsKey)
        WidgetCenter.shared.reloadTimelines(ofKind: PrepSnapshot.widgetKind)
        call.resolve([:])
    }

    @objc func activityStatus(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve(["supported": false, "enabled": false, "active": false])
            return
        }
        call.resolve([
            "supported": true,
            "enabled": ActivityAuthorizationInfo().areActivitiesEnabled,
            "active": !Self.running().isEmpty
        ])
    }

    @objc func startActivity(_ call: CAPPluginCall) { upsert(call) }

    @objc func updateActivity(_ call: CAPPluginCall) { upsert(call) }

    @objc func endActivity(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve(["ended": false, "reason": "unsupported"])
            return
        }
        let activities = Self.running()
        Task {
            for a in activities { await a.end(nil, dismissalPolicy: .immediate) }
            call.resolve(["ended": !activities.isEmpty])
        }
    }

    // MARK: -

    @available(iOS 16.2, *)
    private static func running() -> [Activity<PrepActivityAttributes>] {
        Activity<PrepActivityAttributes>.activities.filter { $0.activityState == .active || $0.activityState == .stale }
    }

    private func upsert(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve(["started": false, "reason": "unsupported"])
            return
        }
        guard let snap = PrepSnapshot.decode(call.getString("data")) else {
            call.resolve(["started": false, "reason": "invalid"])
            return
        }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            call.resolve(["started": false, "reason": "disabled"])
            return
        }
        let content = ActivityContent(state: PrepActivityAttributes.ContentState(snap),
                                      staleDate: PrepSnapshot.endOfDay())
        let existing = Self.running()
        if let first = existing.first {
            Task {
                await first.update(content)
                // A duplicate can only come from an older build or a race; keep exactly one.
                for extra in existing.dropFirst() { await extra.end(nil, dismissalPolicy: .immediate) }
                call.resolve(["started": true, "updated": true])
            }
            return
        }
        do {
            _ = try Activity.request(attributes: PrepActivityAttributes(exam: snap.exam),
                                     content: content, pushType: nil)
            call.resolve(["started": true, "updated": false])
        } catch {
            call.resolve(["started": false, "reason": error.localizedDescription])
        }
    }
}
