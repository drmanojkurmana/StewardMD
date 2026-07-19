import WatchKit
import WidgetKit
import UserNotifications
import StewardMDWatchCore

/// Registers notification categories and handles Long Look actions. An
/// Acknowledge from a notification enqueues a durable, idempotent ack on the
/// same queue the app UI uses (design §10 "every alert carries its response").
final class WatchAppDelegate: NSObject, WKApplicationDelegate, UNUserNotificationCenterDelegate {

    func applicationDidFinishLaunching() {
        UNUserNotificationCenter.current().delegate = self
        LabNotifications.register()
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse) async {
        let info = response.notification.request.content.userInfo
        guard let alert = NotificationParser.parse(info) else { return }
        // Make sure the alert is in the list, then act on the chosen action.
        await ingest(alert)
        switch response.actionIdentifier {
        case LabNotifications.ack:
            await acknowledge(alert)   // optimistic + queued idempotent ack
        case LabNotifications.view, UNNotificationDefaultActionIdentifier:
            WatchServices.store.savePendingRoute("criticalLabs")   // consumed on activation
        case LabNotifications.snooze:
            reschedule(response.notification.request.content, after: 15 * 60)
        default:
            break
        }
    }

    /// Re-delivers the alert after `seconds` (Snooze).
    private func reschedule(_ content: UNNotificationContent, after seconds: TimeInterval) {
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: seconds, repeats: false)
        let req = UNNotificationRequest(identifier: "snooze-\(UUID().uuidString)",
                                        content: content, trigger: trigger)
        UNUserNotificationCenter.current().add(req)
    }

    // Show critical alerts even in the foreground, and surface them in-app.
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification) async
        -> UNNotificationPresentationOptions {
        if let alert = NotificationParser.parse(notification.request.content.userInfo) {
            await ingest(alert)
        }
        return [.banner, .sound, .list]
    }

    // A silent/background push feeds the model, refreshes the badge + widget timelines.
    func didReceiveRemoteNotification(_ userInfo: [AnyHashable: Any]) async -> WKBackgroundFetchResult {
        if let alert = NotificationParser.parse(userInfo) {
            await ingest(alert)
        }
        WidgetCenter.shared.reloadAllTimelines()
        return .newData
    }

    // Labs is main-actor-isolated; route access through these helpers so the
    // nonisolated delegate callbacks hop correctly (Swift 6 concurrency).
    @MainActor private func ingest(_ alert: LabAlert) { WatchServices.labs.ingest(alert) }
    @MainActor private func acknowledge(_ alert: LabAlert) async { await WatchServices.labs.acknowledge(alert) }
}
