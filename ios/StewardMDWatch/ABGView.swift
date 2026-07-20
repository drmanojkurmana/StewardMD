import SwiftUI
import StewardMDWatchCore

/// ABG quick interpreter (design §06): Crown-dial pH / CO₂ / HCO₃ → disorder,
/// compensation, and anion gap. Offline, no PHI.
struct ABGView: View {
    @StateObject private var model = ABGModel()

    var body: some View {
        List {
            crownRow("pH", field: $model.pH, decimals: 2)
            crownRow("CO₂ (kPa)", field: $model.pCO2, decimals: 1)
            crownRow("HCO₃", field: $model.hco3, decimals: 0)

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

    // Bounds come from the model's CrownField (single source of truth — no drift).
    private func crownRow(_ label: String, field: Binding<CrownField>, decimals: Int) -> some View {
        let f = field.wrappedValue
        return HStack {
            Text(label)
            Spacer()
            Text(String(format: "%.\(decimals)f", f.value))
                .monospacedDigit().foregroundStyle(SMDPalette.accent.color)
        }
        .focusable()
        .digitalCrownRotation(field.value, from: f.min, through: f.max, by: f.step, sensitivity: .medium)
    }
}
