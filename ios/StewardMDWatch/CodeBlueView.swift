import SwiftUI
import StewardMDWatchCore

/// Code Blue toolkit (design §06/§07 Flow B): an ACLS timer that runs on the
/// always-on display, pulses a haptic every 2-minute rhythm-check cycle, shows
/// the next drug, and tallies adrenaline/shocks. Fully local — never depends on
/// the network.
struct CodeBlueView: View {
    @StateObject private var model = CodeBlueModel()
    @State private var running = false
    @State private var summary: CodeBlueSummary?

    // Drives the timer once per second while running.
    private let ticker = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        ScrollView {
            VStack(spacing: SMDSpacing.s) {
                SeverityChip(tier: .critical, text: "CODE BLUE")

                Text(model.elapsedLabel)
                    .font(.system(size: 46, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(SMDPalette.text1.color)
                Text("cycle \(model.cycle) · rhythm in \(model.rhythmCountdownLabel)")
                    .font(.caption2).foregroundStyle(SMDPalette.text2.color)

                VStack(alignment: .leading, spacing: 2) {
                    Text("NEXT").font(.caption2).foregroundStyle(SMDPalette.text2.color)
                    Text(model.nextDrug).font(.headline).foregroundStyle(SMDPalette.accent.color)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(SMDSpacing.cardPadding)
                .background(SMDPalette.surface.color, in: RoundedRectangle(cornerRadius: SMDSpacing.radiusCard))

                HStack {
                    Button("Rhythm") { HapticManager.play(.warning) }
                        .tint(SMDPalette.info.color)
                    Button("Adren.") { model.recordAdrenaline(); HapticManager.play(.success) }
                        .tint(SMDPalette.accent.color)
                    Button("Shock") { model.recordShock(); HapticManager.play(.warning) }
                        .tint(SMDPalette.critical.color)
                }
                .font(.caption)

                Button(running ? "End" : "Start") {
                    running.toggle()
                    if !running { summary = model.end() }
                }
                .buttonStyle(.borderedProminent)
                .tint(running ? SMDPalette.critical.color : SMDPalette.success.color)

                if let s = summary {
                    Text("Duration \(s.durationLabel) · \(s.cycles) cycles · \(s.adrenalineCount) adren · \(s.shockCount) shocks\(s.rosc ? " · ROSC ✓" : "")")
                        .font(.caption2).foregroundStyle(SMDPalette.text2.color)
                }
            }
            .padding(SMDSpacing.screenMargin)
        }
        .navigationTitle("Code Blue")
        .onReceive(ticker) { _ in
            guard running else { return }
            if model.tick(1) { HapticManager.play(.critical) }   // 2-min cycle haptic
        }
    }
}
