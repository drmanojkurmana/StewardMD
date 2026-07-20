import SwiftUI
import StewardMDWatchCore

/// iPhone Code Blue Command Center (design §4.3). Live mirror of the watch; opt-in
/// export; local-only data. Presented full-screen from the web home card.
struct CommandCenterView: View {
    @ObservedObject var model = CodeBlueLiveModel.shared
    var onExport: (String) -> Void = { _ in }
    var onClose: () -> Void = {}
    @State private var showShare = false
    @State private var showClearConfirm = false
    @State private var showShockEnergy = false
    @State private var showRhythm = false

    private var s: CodeBlueState { model.state }

    // Unified counters derived from the merged timeline, so events logged on the phone
    // (scribe) count alongside the watch's and survive the next watch snapshot.
    private var shockCount: Int { s.events.filter { $0.kind == .shock }.count }
    private var epiCount: Int {
        s.events.filter { $0.kind == .drug &&
            ($0.label.lowercased().contains("epinephrine") || $0.label.lowercased().contains("adrenaline")) }.count
    }
    private var roscDone: Bool { s.events.contains { $0.kind == .rosc } }

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 16) {
                    connectionRow
                    timerBlock
                    if s.paused { pausedBanner } else { rateBlock }
                    compressionsBlock
                    countersRow
                    if s.running { scribePanel }
                    timelineSection
                    if !s.events.isEmpty { summarySection }
                    Text(CodeSummary.disclaimerText)
                        .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                }
                .padding()
            }
            .background(Color.black.ignoresSafeArea())
            .navigationTitle("Code Blue")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close", action: onClose) }
                ToolbarItem(placement: .primaryAction) {
                    Button(role: .destructive) { showClearConfirm = true } label: {
                        Label("Reset", systemImage: "trash")
                    }
                }
            }
        }
        .preferredColorScheme(.dark)
        .sheet(isPresented: $showShare) { ShareSheet(text: model.codeSheetText()) }
        .confirmationDialog("Clear all Code Blue records on this iPhone?",
                            isPresented: $showClearConfirm, titleVisibility: .visible) {
            Button("Clear records", role: .destructive) { model.clearLocal() }
            Button("Cancel", role: .cancel) {}
        }
        .confirmationDialog("Shock energy", isPresented: $showShockEnergy, titleVisibility: .visible) {
            Button("150 J") { model.logShock(energyJ: 150) }
            Button("200 J") { model.logShock(energyJ: 200) }
            Button("360 J") { model.logShock(energyJ: 360) }
            Button("Log without energy") { model.logShock(energyJ: nil) }
            Button("Cancel", role: .cancel) {}
        }
        .confirmationDialog("Log rhythm", isPresented: $showRhythm, titleVisibility: .visible) {
            Button("VF") { model.logRhythm("VF") }
            Button("VT") { model.logRhythm("VT") }
            Button("PEA") { model.logRhythm("PEA") }
            Button("Asystole") { model.logRhythm("Asystole") }
            Button("Cancel", role: .cancel) {}
        }
    }

    private var scribePanel: some View {
        VStack(spacing: 8) {
            Text("Log (scribe)").font(.headline).foregroundStyle(.white)
                .frame(maxWidth: .infinity, alignment: .leading)
            HStack(spacing: 8) {
                scribeBtn("Epi", .blue) { model.logDrug("Epinephrine") }
                scribeBtn("Amiodarone", .blue) { model.logDrug("Amiodarone") }
                scribeBtn("Other", .blue) { model.logDrug("Other drug") }
            }
            HStack(spacing: 8) {
                scribeBtn("Shock", .orange) { showShockEnergy = true }
                scribeBtn("Rhythm", .teal) { showRhythm = true }
                scribeBtn("ROSC", .green) { model.logROSC() }
            }
        }.padding().background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
    }

    private func scribeBtn(_ title: String, _ tint: Color, _ action: @escaping () -> Void) -> some View {
        Button(action: action) { Text(title).font(.caption).frame(maxWidth: .infinity).padding(.vertical, 8) }
            .buttonStyle(.bordered).tint(tint)
    }

    private var connectionRow: some View {
        HStack(spacing: 8) {
            Circle().fill(model.connected ? Color.green : Color.orange).frame(width: 10, height: 10)
            Text(model.connected ? "Apple Watch connected" : "Watch not reachable")
                .font(.subheadline).foregroundStyle(.white)
            Spacer()
            if s.batteryLevel >= 0 {
                Image(systemName: "battery.100")
                Text("\(Int(s.batteryLevel * 100))%").font(.subheadline).foregroundStyle(.white)
            }
        }
    }

    private var timerBlock: some View {
        VStack {
            Text(TimeFormat.mmss(s.elapsed)).font(.system(size: 64, weight: .bold, design: .rounded))
                .monospacedDigit().foregroundStyle(.white)
            Text("cycle \(s.cycle)").font(.subheadline).foregroundStyle(.secondary)
        }
    }

    private var rateBlock: some View {
        VStack {
            Text("\(s.instantaneousRateCPM)").font(.system(size: 44, weight: .bold, design: .rounded))
                .foregroundStyle(color(for: s.coachZone))
            Text("/min est. · \(RateCoach.guidance(s.coachZone))")
                .font(.headline).foregroundStyle(color(for: s.coachZone))
        }
        .frame(maxWidth: .infinity).padding().background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
    }

    private var pausedBanner: some View {
        Text("CPR PAUSED · \(TimeFormat.mmss(s.pauseSeconds))")
            .font(.title2.bold()).foregroundStyle(.red)
            .frame(maxWidth: .infinity).padding().background(Color.red.opacity(0.12), in: RoundedRectangle(cornerRadius: 16))
    }

    private var compressionsBlock: some View {
        VStack {
            Text("\(s.compressionCount)").font(.system(size: 40, weight: .bold, design: .rounded)).foregroundStyle(.white)
            Text("compressions (est.)").font(.subheadline).foregroundStyle(.secondary)
        }
    }

    private var countersRow: some View {
        HStack(spacing: 12) {
            counter("Shocks", "\(shockCount)", .orange)
            counter("Epi", "\(epiCount)", .blue)
            counter("ROSC", roscDone ? "✓" : "—", roscDone ? .green : .gray)
        }
    }

    private func counter(_ label: String, _ value: String, _ tint: Color) -> some View {
        VStack { Text(value).font(.title2.bold()).foregroundStyle(tint); Text(label).font(.caption).foregroundStyle(.secondary) }
            .frame(maxWidth: .infinity).padding(.vertical, 10).background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
    }

    private var timelineSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Timeline").font(.headline).foregroundStyle(.white)
            ForEach(s.events.reversed()) { e in
                HStack {
                    Text(TimeFormat.mmss(e.elapsed)).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                    Text(label(for: e)).font(.subheadline).foregroundStyle(.white)
                    Spacer()
                }
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }

    private var summarySection: some View {
        VStack(spacing: 10) {
            Text("Code summary").font(.headline).foregroundStyle(.white)
            Text(model.summary().formattedDetail()).font(.footnote).foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button { onExport(model.codeSheetText()) } label: {
                Label("Export to patient record", systemImage: "square.and.arrow.up.on.square")
                    .frame(maxWidth: .infinity)
            }.buttonStyle(.borderedProminent).tint(.red)
            Button { showShare = true } label: { Label("Share…", systemImage: "square.and.arrow.up").frame(maxWidth: .infinity) }
                .buttonStyle(.bordered)
        }.padding().background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
    }

    private func color(for z: RateZone) -> Color {
        switch z { case .onTarget: return .green; case .tooSlow, .tooFast: return .yellow; case .idle: return .gray }
    }
    private func label(for e: CodeEvent) -> String {
        switch e.kind {
        case .cprStart: return "CPR started"; case .cprEnd: return "CPR ended"
        case .shock: return e.label.isEmpty ? "Shock" : e.label
        case .drug: return e.label; case .pauseStart: return "Paused"
        case .resume: return "Resumed"; case .switchCompressor: return "Switch compressor"
        case .rosc: return "ROSC"; case .rhythm: return "Rhythm — \(e.label)"
        }
    }
}

/// UIKit share sheet wrapper.
struct ShareSheet: UIViewControllerRepresentable {
    let text: String
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [text], applicationActivities: nil)
    }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}
