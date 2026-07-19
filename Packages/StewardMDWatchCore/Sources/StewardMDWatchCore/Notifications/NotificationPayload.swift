import Foundation

/// Parses StewardMD APNs payloads into a `LabAlert` and derives the PHI-safe
/// Short Look text + haptic tier (design §10). The Short Look must never leak
/// PHI — it shows only the severity, not name/value/diagnosis.
public enum NotificationParser {

    /// Extracts a `LabAlert` from a push `userInfo`. Requires at least `analyte`.
    public static func parse(_ userInfo: [AnyHashable: Any]) -> LabAlert? {
        guard let analyte = userInfo["analyte"] as? String else { return nil }
        let value = (userInfo["value"] as? String)
            ?? (userInfo["value"] as? NSNumber).map { "\($0)" } ?? ""
        return LabAlert(
            id: (userInfo["id"] as? String) ?? UUID().uuidString,
            analyte: analyte,
            value: value,
            units: userInfo["units"] as? String,
            refRange: userInfo["refRange"] as? String,
            patientLabel: userInfo["patient"] as? String,
            severity: (userInfo["severity"] as? String) ?? "warning",
            ts: (userInfo["ts"] as? Double) ?? (userInfo["ts"] as? NSNumber)?.doubleValue
        )
    }

    /// PHI-free Short Look line.
    public static func shortLookText(_ alert: LabAlert) -> String {
        hapticTier(alert) == .critical ? "Critical result" : "Abnormal result"
    }

    /// Severity → haptic tier.
    public static func hapticTier(_ alert: LabAlert) -> SMDHapticTier {
        switch alert.severity.lowercased() {
        case "critical": return .critical
        case "warning", "abnormal": return .warning
        case "success": return .success
        default: return .info
        }
    }

    /// Pulls the GHIS patient id out of a deep-link URL (`/?ghisPatient=<id>`).
    public static func patientID(fromURL url: String) -> String? {
        guard let comps = URLComponents(string: url) else { return nil }
        return comps.queryItems?.first(where: { $0.name == "ghisPatient" })?.value
    }
}
