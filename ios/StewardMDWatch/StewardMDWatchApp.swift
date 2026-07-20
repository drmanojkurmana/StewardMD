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
    @StateObject private var favorites = FavoritesStore()
    @StateObject private var router = AppRouter()
    @StateObject private var features = FeatureFlagsModel()
    // Shared singletons (also fed by the WC receiver + push handler).
    @ObservedObject private var labs = WatchServices.labs
    @ObservedObject private var watchlist = WatchServices.watchlist
    @ObservedObject private var tasks = WatchServices.tasks
    @ObservedObject private var connectivity = WatchConnectivityManager.shared
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
            .environmentObject(tasks)
            .environmentObject(router)
            .environmentObject(features)
            .preferredColorScheme(.dark)
            .tint(SMDPalette.accent.color)
            .task {
                connectivity.activate()
                await features.refresh()
            }
            .onOpenURL { router.open($0) }
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
