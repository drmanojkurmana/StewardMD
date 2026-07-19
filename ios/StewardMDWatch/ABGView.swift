import SwiftUI
import StewardMDWatchCore

/// ABG quick interpreter (design §06): Crown-dial pH / CO₂ / HCO₃ → disorder,
/// compensation, and anion gap. Offline, no PHI.
struct ABGView: View {
    @StateObject private var model = ABGModel()

    var body: some View {
        List {
            crownRow("pH", value: $model.pH.value, from: 6.80, through: 7.80, by: 0.01, decimals: 2)
            crownRow("CO₂ (kPa)", value: $model.pCO2.value, from: 1.0, through: 15.0, by: 0.1, decimals: 1)
            crownRow("HCO₃", value: $model.hco3.value, from: 1, through: 50, by: 1, decimals: 0)

            VStack(alignment: .leading, spacing: 3) {
                Text(model.result.primary.rawValue)
                    .font(.headline).foregroundStyle(SMDPalette.info.color)
                Text(model.result.compensation.rawValue)
                    .font(.caption2).foregroundStyle(SMDPalette.text2.color)
                if let ag = model.result.anionGap {
                    Text("Anion gap \(Int(ag))\(model.result.raisedAnionGap ? " (raised)" : "")")
                        .font(.caption2).foregroundStyle(SMDPalette.text2.color)
                }
            }
            .listRowBackground(SMDPalette.surface.color)
        }
        .navigationTitle("ABG")
    }

    private func crownRow(_ label: String, value: Binding<Double>,
                          from: Double, through: Double, by: Double, decimals: Int) -> some View {
        HStack {
            Text(label)
            Spacer()
            Text(String(format: "%.\(decimals)f", value.wrappedValue))
                .monospacedDigit().foregroundStyle(SMDPalette.accent.color)
        }
        .focusable()
        .digitalCrownRotation(value, from: from, through: through, by: by, sensitivity: .medium)
    }
}
