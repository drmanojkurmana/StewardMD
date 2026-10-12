import Foundation
import Capacitor
import StewardMDWatchCore
#if canImport(ActivityKit)
import ActivityKit
#endif

/// Phone-app-driven Live Activities (live-activities.js -> WatchBridge.clinicalActivityUpsert / End).
/// One activity per `key`; an upsert updates the running one in place. The clock ticks natively from
/// startedAt / endsAt (ClinicalLiveActivity), so JS only calls when the facts change.
/// Stale after `endsAt` + 30 min (or 4 h for a count-up) so a forgotten activity greys out on its own.
enum ClinicalActivityBridge {
    static func upsert(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        guard #available(iOS 16.2, *) else { call.resolve(["started": false, "reason": "unsupported"]); return }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { call.resolve(["started": false, "reason": "disabled"]); return }
        guard let key = call.getString("key"), !key.isEmpty else { call.resolve(["started": false, "reason": "invalid"]); return }
        let started = Date(timeIntervalSince1970: (call.getDouble("startedAt") ?? Date().timeIntervalSince1970 * 1000) / 1000)
        let endsMs = call.getDouble("endsAt") ?? 0
        let ends: Date? = endsMs > 0 ? Date(timeIntervalSince1970: endsMs / 1000) : nil
        let state = ClinicalActivityAttributes.ContentState(
            title: call.getString("title") ?? "StewardMD",
            detail: call.getString("detail") ?? "",
            startedAt: started, endsAt: ends, urgent: call.getBool("urgent") ?? false)
        let stale = (ends ?? started.addingTimeInterval(4 * 3600)).addingTimeInterval(ends == nil ? 0 : 1800)
        let content = ActivityContent(state: state, staleDate: stale)
        let existing = running(key)
        if let first = existing.first {
            Task {
                await first.update(content)
                for extra in existing.dropFirst() { await extra.end(nil, dismissalPolicy: .immediate) }
                call.resolve(["started": true, "updated": true])
            }
            return
        }
        do {
            let attrs = ClinicalActivityAttributes(key: key,
                                                   symbol: call.getString("symbol") ?? "timer",
                                                   tintHex: call.getString("tint") ?? "#0F766E")
            _ = try Activity.request(attributes: attrs, content: content, pushType: nil)
            call.resolve(["started": true, "updated": false])
        } catch {
            call.resolve(["started": false, "reason": error.localizedDescription])
        }
        #else
        call.resolve(["started": false, "reason": "unsupported"])
        #endif
    }

    static func end(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        guard #available(iOS 16.2, *) else { call.resolve(["ended": false]); return }
        let list = running(call.getString("key"))
        Task {
            for a in list { await a.end(nil, dismissalPolicy: .immediate) }
            call.resolve(["ended": !list.isEmpty])
        }
        #else
        call.resolve(["ended": false])
        #endif
    }

    #if canImport(ActivityKit)
    /// Running activities for `key` (all clinical activities when key is nil).
    @available(iOS 16.2, *)
    private static func running(_ key: String?) -> [Activity<ClinicalActivityAttributes>] {
        Activity<ClinicalActivityAttributes>.activities.filter {
            ($0.activityState == .active || $0.activityState == .stale) && (key == nil || $0.attributes.key == key)
        }
    }
    #endif
}
