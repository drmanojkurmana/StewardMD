import Foundation

/// Maps an estimated compression rate to the AHA target band (design §3.1). Copy is
/// strictly rate-matching guidance — never a CPR-quality/adequacy verdict (§0 safety).
public enum RateCoach {
    public static let lower = 100
    public static let upper = 120

    public static func zone(forRateCPM rate: Int, active: Bool) -> RateZone {
        guard active, rate > 0 else { return .idle }
        if rate < lower { return .tooSlow }
        if rate > upper { return .tooFast }
        return .onTarget
    }

    public static func guidance(_ z: RateZone) -> String {
        switch z {
        case .tooSlow: return "Faster"
        case .onTarget: return "On target"
        case .tooFast: return "Slower"
        case .idle: return "—"
        }
    }
}
