import SwiftUI
import StewardMDWatchCore

/// Procedure stopwatch (design §06): count-up timing for time-outs / sterile
/// fields. Local + AOD-safe.
struct ProcedureTimerView: View {
    @StateObject private var model = ProcedureStopwatch()
    private let ticker = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        VStack(spacing: SMDSpacing.m) {
            Text(model.label)
                .font(.system(size: 48, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(SMDPalette.text1.color)
            HStack {
                Button(model.running ? "Stop" : "Start") {
                    model.running ? model.stop() : model.start()
                }
                .tint(model.running ? SMDPalette.critical.color : SMDPalette.success.color)
                Button("Reset") { model.reset() }
                    .tint(SMDPalette.text2.color)
            }
        }
        .padding(SMDSpacing.screenMargin)
        .navigationTitle("Procedure")
        .onReceive(ticker) { _ in model.tick(1) }
    }
}
