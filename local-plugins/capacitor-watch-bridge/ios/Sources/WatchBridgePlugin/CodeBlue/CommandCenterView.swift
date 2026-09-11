import SwiftUI
import StewardMDWatchCore

/// Production controller. The dashboard displays snapshots; this wrapper owns explicit
/// logging, sharing and destructive-action confirmation through the existing model.
struct CommandCenterView: View {
    @ObservedObject var model = CodeBlueLiveModel.shared
    var onExport: (String) -> Void = { _ in }
    var onClose: () -> Void = {}
    @State private var showShare = false
    @State private var showClearConfirm = false
    @State private var showShockEnergy = false
    @State private var showRhythm = false
    @State private var showMedication = false
    @State private var showROSC = false
    @State private var showExport = false

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            CodeBlueDashboard(
                state: model.state, connected: model.connected,
                receivedAt: model.lastWatchUpdate, now: context.date,
                summaryText: model.summary().formattedDetail(),
                onShock: { showShockEnergy = true },
                onMedication: { showMedication = true },
                onRhythm: { showRhythm = true },
                onROSC: { showROSC = true },
                onShare: { showShare = true },
                onExport: { showExport = true },
                onClear: { showClearConfirm = true },
                onClose: onClose
            )
        }
        .preferredColorScheme(.dark)
        .sheet(isPresented: $showShare) { ShareSheet(text: model.codeSheetText()) }
        .confirmationDialog("Clear all Code Blue records on this iPhone?", isPresented: $showClearConfirm, titleVisibility: .visible) {
            Button("Clear records", role: .destructive) { if !model.state.running { model.clearLocal() } }
            Button("Cancel", role: .cancel) {}
        }
        .confirmationDialog("Record shock energy delivered", isPresented: $showShockEnergy, titleVisibility: .visible) {
            Button("150 J") { model.logShock(energyJ: 150) }
            Button("200 J") { model.logShock(energyJ: 200) }
            Button("360 J") { model.logShock(energyJ: 360) }
            Button("Log without energy") { model.logShock(energyJ: nil) }
            Button("Cancel", role: .cancel) {}
        } message: { Text("Record an event that occurred. These options are not an energy recommendation.") }
        .confirmationDialog("Record rhythm observed", isPresented: $showRhythm, titleVisibility: .visible) {
            Button("VF") { model.logRhythm("VF") }
            Button("VT") { model.logRhythm("VT") }
            Button("PEA") { model.logRhythm("PEA") }
            Button("Asystole") { model.logRhythm("Asystole") }
            Button("Cancel", role: .cancel) {}
        }
        .confirmationDialog("Record medication given", isPresented: $showMedication, titleVisibility: .visible) {
            Button("Epinephrine") { model.logDrug("Epinephrine") }
            Button("Amiodarone") { model.logDrug("Amiodarone") }
            Button("Other drug") { model.logDrug("Other drug") }
            Button("Cancel", role: .cancel) {}
        } message: { Text("Logs the medication name only, not a dose or a treatment order.") }
        .confirmationDialog("Record ROSC?", isPresented: $showROSC, titleVisibility: .visible) {
            Button("Record ROSC") { model.logROSC() }
            Button("Cancel", role: .cancel) {}
        } message: { Text("Add return of spontaneous circulation to the timeline. Session controls remain on the watch.") }
        .confirmationDialog("Export to the current patient record?", isPresented: $showExport, titleVisibility: .visible) {
            Button("Export record") { onExport(model.codeSheetText()) }
            Button("Cancel", role: .cancel) {}
        } message: { Text("Confirm the correct patient is open in StewardMD. Without a patient in context, the record remains on this iPhone.") }
    }
}

struct ShareSheet: UIViewControllerRepresentable {
    let text: String
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [text], applicationActivities: nil)
    }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}
