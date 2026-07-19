import SwiftUI
import StewardMDWatchCore

/// Lab detail (design §05 + §13 annotated screen): severity header, big tabular
/// value, reference gauge, and a full-width Acknowledge that fires a success
/// haptic and updates optimistically (queued offline). Crown scrolls toward the
/// 7-day trend (delivered in Phase 3).
struct LabDetailView: View {
    let alert: LabAlert
    @EnvironmentObject private var labs: CriticalLabsModel
    @State private var loggedAt: String?

    private var tier: SMDHapticTier { NotificationParser.hapticTier(alert) }
    private var acknowledged: Bool { labs.isAcknowledged(alert.id) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: SMDSpacing.s) {
                SeverityChip(tier: tier, text: tier == .critical ? "CRITICAL" : "ABNORMAL")

                Text("\(alert.analyte) · serum")
                    .font(.caption).foregroundStyle(SMDPalette.text2.color)

                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(alert.value)
                        .font(.system(size: 44, weight: .bold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(tier.color.color)
                    if let u = alert.units {
                        Text(u).font(.caption).foregroundStyle(SMDPalette.text2.color)
                    }
                }

                if let (lo, hi) = parsedRange, let v = Double(numeric(alert.value)) {
                    ReferenceGauge(value: v, low: lo, high: hi)
                    if let r = alert.refRange {
                        Text(r).font(.caption2).foregroundStyle(SMDPalette.text2.color)
                    }
                }

                if let p = alert.patientLabel {
                    Text(p).font(.caption2).foregroundStyle(SMDPalette.text2.color)
                }

                acknowledgeButton
                if let logged = loggedAt {
                    Text("Logged \(logged)")
                        .font(.caption2).foregroundStyle(SMDPalette.success.color)
                }
            }
            .padding(SMDSpacing.screenMargin)
        }
        .navigationTitle(alert.analyte)
    }

    @ViewBuilder private var acknowledgeButton: some View {
        Button {
            Task {
                await labs.acknowledge(alert)
                HapticManager.play(.success)
                loggedAt = timeNow()
            }
        } label: {
            Text(acknowledged ? "Acknowledged" : "Acknowledge")
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .tint(acknowledged ? SMDPalette.success.color : SMDPalette.critical.color)
        .disabled(acknowledged)
    }

    // MARK: helpers
    private var parsedRange: (Double, Double)? {
        guard let r = alert.refRange else { return nil }
        let parts = r.replacingOccurrences(of: "–", with: "-")
            .split(separator: "-").map { numeric(String($0)) }
        guard parts.count == 2, let lo = Double(parts[0]), let hi = Double(parts[1]) else { return nil }
        return (lo, hi)
    }
    private func numeric(_ s: String) -> String {
        s.filter { "0123456789.".contains($0) }
    }
    private func timeNow() -> String {
        let c = Calendar.current.dateComponents([.hour, .minute], from: Date())
        return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
    }
}
