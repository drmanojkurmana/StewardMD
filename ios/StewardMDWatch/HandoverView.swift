import SwiftUI
import StewardMDWatchCore

/// Handover assistant (design §06): the auto-assembled sick-list — flagged first
/// — ticked off as you hand over. SBAR-ready, transferable to the incoming team.
struct HandoverView: View {
    @EnvironmentObject private var watchlist: WatchlistModel
    @StateObject private var model = HandoverModel()

    var body: some View {
        List {
            ForEach(model.items) { entry in
                Button {
                    model.toggle(entry.id); HapticManager.play(.success)
                } label: {
                    HStack(spacing: SMDSpacing.s) {
                        Image(systemName: model.isHandedOff(entry.id) ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(model.isHandedOff(entry.id) ? SMDPalette.success.color : SMDPalette.text2.color)
                            .accessibilityLabel(model.isHandedOff(entry.id) ? "Handed off" : "Not handed off")
                        VStack(alignment: .leading, spacing: 1) {
                            Text(entry.name).foregroundStyle(SMDPalette.text1.color)
                            if let flag = entry.flag {
                                Text(flag).font(.caption2).foregroundStyle(entry.severity.color.color)
                            }
                        }
                    }
                }
                .buttonStyle(.plain)
                .listRowBackground(SMDPalette.surface.color)
            }
            Text(model.footer)
                .font(.caption2).foregroundStyle(SMDPalette.text2.color)
                .listRowBackground(Color.clear)
        }
        .navigationTitle("Handover")
        .onAppear { model.assemble(from: watchlist.entries) }
    }
}
