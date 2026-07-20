import SwiftUI
import Combine
import StewardMDWatchCore

/// Procedure stopwatch (design §06): count-up timing for time-outs / sterile
/// fields. Local + AOD-safe.
struct ProcedureTimerView: View {
    @StateObject private var model = ProcedureStopwatch()
    @State private var startDate: Date?
    @Environment(\.scenePhase) private var scenePhase
    private let ticker = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    // Wall-clock derived so AOD / wrist-down gaps self-correct on next update.
    private func syncTick() {
        guard model.running, let s = startDate else { return }
        model.sync(to: Date().timeIntervalSince(s))
    }

    var body: some View {
        VStack(spacing: SMDSpacing.m) {
            Text(model.label)
                .font(.system(size: 48, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(SMDPalette.text1.color)
            HStack {
                Button(model.running ? "Stop" : "Start") {
                    if model.running { model.stop() }
                    else { model.start(); startDate = Date().addingTimeInterval(-model.elapsed) }
                }
                .tint(model.running ? SMDPalette.critical.color : SMDPalette.success.color)
                Button("Reset") { model.reset(); startDate = nil }
                    .tint(SMDPalette.text2.color)
            }
        }
        .padding(SMDSpacing.screenMargin)
        .navigationTitle("Procedure")
        .onReceive(ticker) { _ in syncTick() }
        .onChange(of: scenePhase) { _, phase in if phase == .active { syncTick() } }
    }
}
