import SwiftUI
import StewardMDWatchCore

/// Critical Labs (design §05): ranked by urgency, not time. Crown scrolls; a tap
/// pushes the lab detail. Empty state per §13 component matrix.
struct CriticalLabsView: View {
    @EnvironmentObject private var labs: CriticalLabsModel

    var body: some View {
        Group {
            if labs.labs.isEmpty {
                ContentUnavailableView("No critical results",
                                       systemImage: "checkmark.circle",
                                       description: Text("You're all caught up."))
            } else {
                List(labs.labs) { alert in
                    NavigationLink(value: alert) {
                        LabRow(alert: alert, acknowledged: labs.isAcknowledged(alert.id))
                    }
                    .listRowBackground(SMDPalette.surface.color)
                }
            }
        }
        .navigationTitle("Critical labs")
        .navigationDestination(for: LabAlert.self) { LabDetailView(alert: $0) }
    }
}

private struct LabRow: View {
    let alert: LabAlert
    let acknowledged: Bool
    private var tier: SMDHapticTier { NotificationParser.hapticTier(alert) }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                SeverityChip(tier: tier, text: tier == .critical ? "CRITICAL" : "ABNORMAL")
                Spacer()
                if acknowledged {
                    Image(systemName: "checkmark").font(.caption2)
                        .foregroundStyle(SMDPalette.success.color)
                }
            }
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Text(alert.analyte).font(.caption).foregroundStyle(SMDPalette.text2.color)
                Text(alert.value)
                    .font(.system(.title3, design: .rounded)).bold().monospacedDigit()
                    .foregroundStyle(tier.color.color)
                if let u = alert.units {
                    Text(u).font(.caption2).foregroundStyle(SMDPalette.text2.color)
                }
            }
            if let p = alert.patientLabel {
                Text(p).font(.caption2).foregroundStyle(SMDPalette.text2.color)
            }
        }
        .frame(minHeight: SMDSpacing.minTapTarget)
    }
}
