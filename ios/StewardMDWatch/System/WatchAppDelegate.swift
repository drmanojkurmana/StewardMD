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
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse) async {
        let info = response.notification.request.content.userInfo
        guard response.actionIdentifier == LabNotifications.ack,
              let alert = NotificationParser.parse(info) else { return }
        let ack = Ack(id: "ack-\(alert.id)", labId: alert.id,
                      patientLabel: alert.patientLabel, ackedAt: Date().timeIntervalSince1970)
        await WatchServices.ackQueue.enqueue(ack)
        await WatchServices.ackQueue.flush()
    }

    // Show critical alerts even in the foreground.
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification) async
        -> UNNotificationPresentationOptions {
        [.banner, .sound, .list]
    }
}
