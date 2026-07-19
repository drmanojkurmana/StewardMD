import SwiftUI
import StewardMDWatchCore

/// Emergency entry (design §01 "born on the wrist" + §06 rapid tools). Phase 2
/// ships Code Blue; the sepsis bundle, procedure timers, ABG, and the rapid-tool
/// grid arrive in Phase 4. Also reachable via the Action button / Siri.
struct EmergencyView: View {
    var body: some View {
        List {
            NavigationLink { CodeBlueView() } label: {
                Label("Code Blue", systemImage: "bolt.heart.fill")
                    .foregroundStyle(SMDPalette.critical.color)
            }
            .listRowBackground(SMDPalette.surface.color)

            Label("Sepsis 1-hr bundle", systemImage: "hourglass")
                .foregroundStyle(SMDPalette.text2.color)
                .listRowBackground(SMDPalette.surface.color)
            Label("ABG interpreter", systemImage: "wind")
                .foregroundStyle(SMDPalette.text2.color)
                .listRowBackground(SMDPalette.surface.color)
        }
        .navigationTitle("Emergency")
    }
}
