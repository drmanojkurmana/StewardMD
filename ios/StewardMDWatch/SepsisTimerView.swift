import SwiftUI
import StewardMDWatchCore

/// Sepsis 1-hour bundle (design §06): amber countdown ring + live checklist with
/// escalating haptics near the deadline. Local timer.
struct SepsisTimerView: View {
    @StateObject private var model = SepsisTimerModel()
    @State private var running = false
    private let ticker = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        ScrollView {
            VStack(spacing: SMDSpacing.s) {
                Gauge(value: model.progress) {
                    Text(model.remainingLabel).monospacedDigit()
                }
                .gaugeStyle(.accessoryCircularCapacity)
                .tint(model.shouldNudge ? SMDPalette.critical.color : SMDPalette.warning.color)
                .frame(height: 90)

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

                Button(running ? "Pause" : "Start") { running.toggle() }
                    .buttonStyle(.borderedProminent)
                    .tint(SMDPalette.warning.color)
            }
            .padding(SMDSpacing.screenMargin)
        }
        .navigationTitle("Sepsis bundle")
        .onReceive(ticker) { _ in
            guard running else { return }
            let wasNudging = model.shouldNudge
            model.tick(1)
            if model.shouldNudge && !wasNudging { HapticManager.play(.warning) }
            if model.isExpired { running = false; HapticManager.play(.critical) }
        }
    }
}
