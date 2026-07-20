import SwiftUI
import StewardMDWatchCore

/// Icon-paired severity pill (design §11 component #5). Color is never the sole
/// signal — always accompanied by a label + SF Symbol.
struct SeverityChip: View {
    let tier: SMDHapticTier
    let text: String

    private var symbol: String {
        switch tier {
        case .critical: return "exclamationmark.triangle.fill"
        case .warning: return "arrow.up.right"
        case .success: return "checkmark.circle.fill"
        case .info: return "info.circle.fill"
        }
    }

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: symbol)
            Text(text).fontWeight(.bold)
        }
        .font(.caption2)
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        // Dark text on the bright severity fill clears AA on every tier
        // (white would fail on warning/success/info used as a background).
        .foregroundStyle(SMDPalette.canvas.color)
        .background(tier.color.color, in: Capsule())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(text), \(tier.rawValue)")
    }
}
