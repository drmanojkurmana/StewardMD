import SwiftUI
import StewardMDWatchCore

/// StewardMD watchOS app entry point. Dark-mode-first (OLED). The root is a
/// Crown-scrollable vertical list (design §04 IA); detail views push one level.
/// A `WKNotificationScene` supplies the Long Look for critical-lab alerts.
@main
struct StewardMDWatchApp: App {
    @WKApplicationDelegateAdaptor(WatchAppDelegate.self) private var delegate
    @StateObject private var session = WatchSessionStore()
    @StateObject private var labs = CriticalLabsModel(ackQueue: WatchServices.ackQueue)

    var body: some Scene {
        WindowGroup {
            NavigationStack {
                RootListView()
            }
            .environmentObject(session)
            .environmentObject(labs)
            .preferredColorScheme(.dark)
            .tint(SMDPalette.accent.color)
        }

        WKNotificationScene(controller: NotificationController.self,
                            category: LabNotifications.category)
    }
}
