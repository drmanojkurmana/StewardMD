import SwiftUI
import StewardMDWatchCore

/// Sepsis 1-hour bundle (design §06): amber countdown ring + live checklist with
/// escalating haptics near the deadline. Local timer.
struct SepsisTimerView: View {
    @StateObject private var model = SepsisTimerModel()
    @State private var running = false
    @State private var startDate: Date?
    @Environment(\.scenePhase) private var scenePhase
    private let ticker = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    // Wall-clock derived so AOD / wrist-down gaps self-correct on next update.
    private func syncTick() {
        guard running, let s = startDate else { return }
        let wasNudging = model.shouldNudge
        model.sync(to: Date().timeIntervalSince(s))
        if model.shouldNudge && !wasNudging { HapticManager.play(.warning) }
        if model.isExpired { running = false; HapticManager.play(.critical) }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: SMDSpacing.s) {
                // Ring fills as the hour elapses (countdown); label = time left.
                Gauge(value: model.timeFraction) {
                    Text(model.remainingLabel).monospacedDigit()
                }
                .gaugeStyle(.accessoryCircularCapacity)
                .tint(model.shouldNudge ? SMDPalette.critical.color : SMDPalette.warning.color)
                .frame(height: 90)

                // Checklist completion, shown separately from the time ring.
                Text("Bundle \(Int(model.progress * 4))/4")
                    .font(.caption2).foregroundStyle(SMDPalette.text2.color)

                ForEach(SepsisTimerModel.Step.allCases, id: \.self) { step in
                    Button {
                        model.toggle(step); HapticManager.play(.success)
                    } label: {
                        HStack {
                            Image(systemName: model.isDone(step) ? "checkmark.circle.fill" : "circle")
                                .foregroundStyle(model.isDone(step) ? SMDPalette.success.color : SMDPalette.text2.color)
                            Text(step.label).foregroundStyle(SMDPalette.text1.color)
                        }
                    }
                    .buttonStyle(.plain)
                }

                Button(running ? "Pause" : "Start") {
                    running.toggle()
                    if running { startDate = Date().addingTimeInterval(-model.elapsed) }
                }
                .buttonStyle(.borderedProminent)
                .tint(SMDPalette.warning.color)
            }
            .padding(SMDSpacing.screenMargin)
        }
        .navigationTitle("Sepsis bundle")
        .onReceive(ticker) { _ in syncTick() }
        .onChange(of: scenePhase) { _, phase in if phase == .active { syncTick() } }
    }
}
