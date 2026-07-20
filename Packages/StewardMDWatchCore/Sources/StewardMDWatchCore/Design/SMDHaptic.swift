import Foundation

/// Notification/haptic severity tiers (design §10). The watch app maps each to
/// a `WKHapticType` pattern; here we keep the tier + behavior as data so the
/// mapping is testable and shared with widgets/complications.
public enum SMDHapticTier: String, Equatable, CaseIterable, Sendable {
    case critical   // double strong + repeat @30s — labs, code blue, ICU deterioration
    case warning    // directional up, single firm — abnormal labs, sepsis nudge, overdue
    case info       // light click — assignment, guideline update, result filed
    case success    // success chime — ack confirmed, task complete, handover sent

    /// Whether the pattern repeats until the alert is acknowledged.
    public var repeats: Bool { self == .critical }

    /// The palette color that pairs with this tier (color is never the sole signal).
    public var color: SMDColor {
        switch self {
        case .critical: return SMDPalette.critical
        case .warning: return SMDPalette.warning
        case .info: return SMDPalette.patient
        case .success: return SMDPalette.success
        }
    }
}
