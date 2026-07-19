import Foundation

/// Parses StewardMD APNs payloads into a `LabAlert` and derives the PHI-safe
/// Short Look text + haptic tier (design §10). The Short Look must never leak
/// PHI — it shows only the severity, not name/value/diagnosis.
public enum NotificationParser {

    /// Extracts a `LabAlert` from a push `userInfo`. Prefers structured fields
    /// (`analyte`/`value`/`severity`), but also handles the current generic
    /// Lab-Watch payload (`aps.alert.title/body` + `url=?ghisPatient=…`) so real
    /// pushes still yield a usable, deep-linkable alert. Returns nil only when
    /// there is neither a structured analyte nor an aps alert.
    public static func parse(_ userInfo: [AnyHashable: Any]) -> LabAlert? {
        let aps = userInfo["aps"] as? [AnyHashable: Any]
        let alert = aps?["alert"] as? [AnyHashable: Any]
        let title = alert?["title"] as? String
        let body = alert?["body"] as? String
        let url = userInfo["url"] as? String

        let structuredAnalyte = userInfo["analyte"] as? String
        guard structuredAnalyte != nil || title != nil || body != nil else { return nil }

        let analyte = structuredAnalyte ?? title ?? "New result"
        let value = (userInfo["value"] as? String)
            ?? (userInfo["value"] as? NSNumber).map { "\($0)" }
            ?? (structuredAnalyte == nil ? (body ?? "") : "")
        let patient = (userInfo["patient"] as? String) ?? patientLabelFromTitle(title)

        return LabAlert(
            id: (userInfo["id"] as? String) ?? url ?? UUID().uuidString,
            analyte: analyte,
            value: value,
            units: userInfo["units"] as? String,
            refRange: userInfo["refRange"] as? String,
            patientLabel: patient,
            severity: (userInfo["severity"] as? String) ?? "warning",
            ts: (userInfo["ts"] as? Double) ?? (userInfo["ts"] as? NSNumber)?.doubleValue
        )
    }

    /// "New lab — R. Okafor" → "R. Okafor".
    private static func patientLabelFromTitle(_ title: String?) -> String? {
        guard let t = title, let r = t.range(of: "—") else { return nil }
        let s = t[r.upperBound...].trimmingCharacters(in: .whitespaces)
        return s.isEmpty ? nil : s
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
