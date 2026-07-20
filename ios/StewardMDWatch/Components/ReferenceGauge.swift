import SwiftUI
import StewardMDWatchCore

/// Horizontal reference-range gauge (design §05 lab detail, §13 pin #3): maps a
/// value onto low…high with a white marker. Marker position is redundant with
/// the severity color so it reads for color-blind users and VoiceOver.
struct ReferenceGauge: View {
    let value: Double
    let low: Double
    let high: Double

    /// 0…1 marker position, clamped, with a little padding beyond the range.
    private var fraction: Double {
        let lo = low - (high - low) * 0.25
        let hi = high + (high - low) * 0.25
        guard hi > lo else { return 0.5 }
        return min(max((value - lo) / (hi - lo), 0), 1)
    }

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                LinearGradient(
                    colors: [SMDPalette.info.color, SMDPalette.success.color,
                             SMDPalette.warning.color, SMDPalette.critical.color],
                    startPoint: .leading, endPoint: .trailing
                )
                .frame(height: 6)
                .clipShape(Capsule())

                Rectangle()
                    .fill(SMDPalette.text1.color)
                    .frame(width: 3, height: 14)
                    .offset(x: geo.size.width * fraction - 1.5)
            }
        }
        .frame(height: 14)
        .accessibilityLabel("Reference range \(low) to \(high), value \(value)")
    }
}
