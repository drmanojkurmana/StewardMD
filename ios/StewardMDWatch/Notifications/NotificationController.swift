import SwiftUI
import WatchKit
import UserNotifications
import StewardMDWatchCore

/// Long Look for a critical/abnormal lab (design §10). Short Look (system) shows
/// only the PHI-free severity line; the Long Look reveals the value + bed +
/// inline actions (Acknowledge / View / Snooze). PHI never appears on the AOD.
struct LabNotificationView: View {
    let alert: LabAlert?

    var body: some View {
        if let a = alert {
            let tier = NotificationParser.hapticTier(a)
            VStack(alignment: .leading, spacing: SMDSpacing.s) {
                SeverityChip(tier: tier, text: tier == .critical ? "CRITICAL LAB" : "ABNORMAL LAB")
                HStack(alignment: .firstTextBaseline, spacing: 5) {
                    Text(a.analyte).font(.caption).foregroundStyle(SMDPalette.text2.color)
                    Text(a.value)
                        .font(.system(.title2, design: .rounded)).bold().monospacedDigit()
                        .foregroundStyle(tier.color.color)
                    if let u = a.units { Text(u).font(.caption2).foregroundStyle(SMDPalette.text2.color) }
                }
                if let p = a.patientLabel {
                    Text(p).font(.caption2).foregroundStyle(SMDPalette.text2.color)
                }
            }
            .padding(SMDSpacing.screenMargin)
        } else {
            Text("StewardMD alert").font(.headline)
        }
    }
}

/// Hosts the Long Look and parses the incoming payload.
final class NotificationController: WKUserNotificationHostingController<LabNotificationView> {
    private var alert: LabAlert?

    override var body: LabNotificationView { LabNotificationView(alert: alert) }

    override func didReceive(_ notification: UNNotification) {
        let parsed = NotificationParser.parse(notification.request.content.userInfo)
        alert = parsed
        // Surface the alert in the app's Critical Labs list too.
        if let a = parsed { Task { @MainActor in WatchServices.labs.ingest(a) } }
    }
}

/// Notification categories + action identifiers (design §10 inline actions).
enum LabNotifications {
    static let category = "CRITICAL_LAB"
    static let ack = "ACK"
    static let view = "VIEW"
    static let snooze = "SNOOZE"

    static func register() {
        let ackAction = UNNotificationAction(identifier: ack, title: "Acknowledge",
                                             options: [.authenticationRequired])
        let viewAction = UNNotificationAction(identifier: view, title: "View", options: [.foreground])
        let snoozeAction = UNNotificationAction(identifier: snooze, title: "Snooze", options: [])
        let cat = UNNotificationCategory(identifier: category,
                                         actions: [ackAction, viewAction, snoozeAction],
                                         intentIdentifiers: [], options: [])
        UNUserNotificationCenter.current().setNotificationCategories([cat])
    }
}
