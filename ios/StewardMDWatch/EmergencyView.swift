import SwiftUI
import StewardMDWatchCore

/// Emergency hub (design §01 "born on the wrist" + §06). Code Blue, the sepsis
/// 1-hour bundle, ABG interpreter, and a procedure stopwatch — each one push
/// away. Also reachable via Siri / the Action button.
struct EmergencyView: View {
    var body: some View {
        List {
            row("Code Blue", "bolt.heart.fill", SMDPalette.critical, .codeBlue)
            row("Sepsis 1-hr bundle", "hourglass", SMDPalette.warning, .sepsis)
            row("ABG interpreter", "wind", SMDPalette.info, .abg)
            row("Procedure timer", "stopwatch", SMDPalette.teal, .procedure)
        }
        .navigationTitle("Emergency")
    }

    private func row(_ title: String, _ symbol: String, _ color: SMDColor,
                     _ route: EmergencyRoute) -> some View {
        NavigationLink(value: route) {
            Label(title, systemImage: symbol).foregroundStyle(color.color)
        }
        .listRowBackground(SMDPalette.surface.color)
    }
}
