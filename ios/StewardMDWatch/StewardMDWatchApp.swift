import SwiftUI
import StewardMDWatchCore

/// StewardMD watchOS app entry point. Dark-mode-first (OLED). The root is a
/// Crown-scrollable vertical list (design §04 IA); detail views push one level.
/// A `WKNotificationScene` supplies the Long Look for critical-lab alerts, and
/// `AppRouter` consumes Siri / Action-button deep links on activation.
@main
struct StewardMDWatchApp: App {
    @WKApplicationDelegateAdaptor(WatchAppDelegate.self) private var delegate
    @StateObject private var session = WatchSessionStore()
    @StateObject private var labs = CriticalLabsModel(ackQueue: WatchServices.ackQueue)
    @StateObject private var favorites = FavoritesStore()
    @StateObject private var watchlist = WatchlistModel()
    @StateObject private var router = AppRouter()
    @StateObject private var features = FeatureFlagsModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            NavigationStack(path: $router.path) {
                RootListView()
            }
            .environmentObject(session)
            .environmentObject(labs)
            .environmentObject(favorites)
            .environmentObject(watchlist)
            .environmentObject(router)
            .environmentObject(features)
            .preferredColorScheme(.dark)
            .tint(SMDPalette.accent.color)
            .task { await features.refresh() }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active {
                    router.consumePending()
                    Task { await features.refresh() }
                }
            }
        }

        WKNotificationScene(controller: NotificationController.self,
                            category: LabNotifications.category)
    }
}
