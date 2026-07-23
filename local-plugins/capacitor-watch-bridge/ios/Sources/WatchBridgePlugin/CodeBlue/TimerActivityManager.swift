import Foundation
import StewardMDWatchCore
#if canImport(ActivityKit)
import ActivityKit
#endif

/// Phone-side driver for the Sepsis-bundle + Procedure Live Activities (design §09). The watch sends a
/// single `timerActivity` relay message on start/stop (WatchConnectivityRelay re-posts it); this
/// starts/ends the matching Activity. The running clock ticks NATIVELY from `startedAt`, so there are
/// no per-second updates — one request + one end per timer. iOS 16.2+ / ActivityKit only.
@MainActor
final class TimerActivityManager {
    static let shared = TimerActivityManager()

    #if canImport(ActivityKit)
    private var sepsis: Any?      // Activity<SepsisActivityAttributes>? (Any? — the type is @available-gated)
    private var procedure: Any?   // Activity<ProcedureActivityAttributes>?
    #endif

    /// Wire up the relay observer. Idempotent; call at plugin load.
    func begin() {
        NotificationCenter.default.addObserver(forName: WatchConnectivityRelay.timerActivityReceived,
                                               object: nil, queue: .main) { [weak self] note in
            let info = note.userInfo ?? [:]
            Task { @MainActor in self?.handle(info) }
        }
    }

    private func handle(_ info: [AnyHashable: Any]) {
        #if canImport(ActivityKit)
        guard #available(iOS 16.2, *), ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        let type = info["timerType"] as? String ?? ""
        let running = (info["running"] as? Bool) ?? false
        let epoch = (info["startedAt"] as? Double) ?? (info["startedAt"] as? NSNumber)?.doubleValue ?? Date().timeIntervalSince1970
        let started = Date(timeIntervalSince1970: epoch)

        switch type {
        case "sepsis":
            let target = (info["targetSeconds"] as? Double) ?? (info["targetSeconds"] as? NSNumber)?.doubleValue ?? 3600
            let done = (info["bundleDone"] as? Int) ?? (info["bundleDone"] as? NSNumber)?.intValue ?? 0
            let content = ActivityContent(
                state: SepsisActivityAttributes.ContentState(bundleDone: done, expired: Date() > started.addingTimeInterval(target)),
                staleDate: nil)
            if running {
                if let a = sepsis as? Activity<SepsisActivityAttributes> { Task { await a.update(content) } }
                else { sepsis = try? Activity.request(attributes: SepsisActivityAttributes(startedAt: started, targetSeconds: target), content: content) }
            } else if let a = sepsis as? Activity<SepsisActivityAttributes> {
                Task { await a.end(content, dismissalPolicy: .default) }; sepsis = nil
            }
        case "procedure":
            let content = ActivityContent(state: ProcedureActivityAttributes.ContentState(running: running), staleDate: nil)
            if running {
                if let a = procedure as? Activity<ProcedureActivityAttributes> { Task { await a.update(content) } }
                else { procedure = try? Activity.request(attributes: ProcedureActivityAttributes(startedAt: started, label: "Procedure"), content: content) }
            } else if let a = procedure as? Activity<ProcedureActivityAttributes> {
                Task { await a.end(content, dismissalPolicy: .default) }; procedure = nil
            }
        default:
            break
        }
        #endif
    }
}
