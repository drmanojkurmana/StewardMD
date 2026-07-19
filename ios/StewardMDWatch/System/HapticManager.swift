import WatchKit
import StewardMDWatchCore

/// Maps StewardMD severity tiers to watchOS haptics (design §10). Critical uses
/// the strongest `.notification` pattern; success the `.success` chime.
enum HapticManager {
    static func play(_ tier: SMDHapticTier) {
        WKInterfaceDevice.current().play(hapticType(for: tier))
    }

    private static func hapticType(for tier: SMDHapticTier) -> WKHapticType {
        switch tier {
        case .critical: return .notification
        case .warning: return .directionUp
        case .info: return .click
        case .success: return .success
        }
    }
}
