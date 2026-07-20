import WatchKit
import UserNotifications
import StewardMDWatchCore

/// Registers notification categories and handles Long Look actions. An
/// Acknowledge from a notification enqueues a durable, idempotent ack on the
/// same queue the app UI uses (design §10 "every alert carries its response").
final class WatchAppDelegate: NSObject, WKApplicationDelegate, UNUserNotificationCenterDelegate {

    func applicationDidFinishLaunching() {
        UNUserNotificationCenter.current().delegate = self
        LabNotifications.register()
        // Register for APNs so criticals + task assignments can buzz the wrist
        // directly (the phone registers this token with the backend).
        WKApplication.shared().registerForRemoteNotifications()
    }

    func didRegisterForRemoteNotifications(withDeviceToken deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        Task { @MainActor in WatchConnectivityManager.shared.sendWatchPushToken(hex) }
    }

    func didFailToRegisterForRemoteNotificationsWithError(_ error: Error) {
        // Non-fatal: the watch still works via the phone relay + local notifications.
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse) async {
        let info = response.notification.request.content.userInfo
        // Non-lab pushes (e.g. a task assignment) deep-link via an explicit route.
        if let route = info["route"] as? String, NotificationParser.parse(info) == nil {
            WatchServices.store.savePendingRoute(route)
            return
        }
        guard let alert = NotificationParser.parse(info) else { return }
        // Make sure the alert is in the list, then act on the chosen action.
        ingest(alert)
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
            ingest(alert)
        }
        return [.banner, .sound, .list]
    }

    // Note: no `didReceiveRemoteNotification` (silent/background) override — alert
    // pushes are shown by the system and ingested on tap (didReceive) or foreground
    // (willPresent); the WC relay + activate() reconcile the model on next launch.

    // Labs is main-actor-isolated; route access through these helpers so the
    // nonisolated delegate callbacks hop correctly (Swift 6 concurrency).
    @MainActor private func ingest(_ alert: LabAlert) { WatchServices.labs.ingest(alert) }
    @MainActor private func acknowledge(_ alert: LabAlert) async { await WatchServices.labs.acknowledge(alert) }
}
