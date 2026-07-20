import Foundation

/// Remote feature-management payload from `GET /api/watch-config` (Phase 6).
/// Enables/disables watch features without a native app update, plus a global
/// kill switch, a minimum-version floor, and an optional announcement banner.
public struct FeatureFlags: Codable, Equatable, Sendable {
    public let flags: [String: Bool]
    public let minVersion: String?
    public let announcement: String?
    public let killSwitch: Bool

    public init(flags: [String: Bool], minVersion: String?, announcement: String?, killSwitch: Bool = false) {
        self.flags = flags
        self.minVersion = minVersion
        self.announcement = announcement
        self.killSwitch = killSwitch
    }

    enum CodingKeys: String, CodingKey { case flags, minVersion, announcement, killSwitch }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        flags = try c.decodeIfPresent([String: Bool].self, forKey: .flags) ?? [:]
        minVersion = try c.decodeIfPresent(String.self, forKey: .minVersion)
        announcement = try c.decodeIfPresent(String.self, forKey: .announcement)
        killSwitch = try c.decodeIfPresent(Bool.self, forKey: .killSwitch) ?? false
    }

    /// A feature is on only if the kill switch is off and the flag is explicitly true.
    public func isEnabled(_ key: String) -> Bool {
        guard !killSwitch else { return false }
        return flags[key] ?? false
    }

    /// True when the running app is below the remotely-set minimum version.
    public func requiresUpdate(currentVersion: String) -> Bool {
        guard let minV = minVersion else { return false }
        return SemVer.compare(currentVersion, minV) < 0
    }

    public static let empty = FeatureFlags(flags: [:], minVersion: nil, announcement: nil, killSwitch: false)

    /// The offline fallback: what the current build ships with enabled, so that
    /// with no network the shipped features still work (only server config can
    /// override these). Mirrors the backend `/api/watch-config` defaults.
    public static let shippedDefaults = FeatureFlags(
        flags: [
            "criticalLabs": true, "drugLookup": true, "codeBlue": true,
            "wardSync": true, "calculators": true, "sepsisTimer": true,
            "procedureTimer": true, "abg": true, "handover": true,
            "antibioticSummary": false, "icuDeterioration": false
        ],
        minVersion: "1.0.0", announcement: nil, killSwitch: false
    )
}
