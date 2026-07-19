import SwiftUI
import StewardMDWatchCore

/// StewardMD watchOS app entry point. Dark-mode-first (OLED). The root is a
/// Crown-scrollable vertical list (design §04 IA); detail views push one level.
@main
struct StewardMDWatchApp: App {
    @StateObject private var session = WatchSessionStore()

    var body: some Scene {
        WindowGroup {
            NavigationStack {
                RootListView()
            }
            .environmentObject(session)
            .preferredColorScheme(.dark)
            .tint(SMDPalette.accent.color)
        }
    }
}
