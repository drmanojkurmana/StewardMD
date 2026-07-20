import Foundation

/// A gateable watch feature. `requiresPro` marks features behind the paid tier
/// (subscription-based watch features, per the remote-management brief).
public enum WatchFeature: String, CaseIterable, Sendable {
    case criticalLabs, drugLookup, codeBlue, calculators, sepsisTimer,
         procedureTimer, abg, handover, wardSync, antibioticSummary, icuDeterioration

    public var requiresPro: Bool {
        switch self {
        case .wardSync, .antibioticSummary, .icuDeterioration: return true
        default: return false
        }
    }
}

/// The outcome of evaluating a feature for the current user + build + remote config.
public enum GateResult: Equatable, Sendable {
    case allowed
    case disabledRemotely   // flag off or kill switch
    case needsPro           // subscription-gated, user not Pro
    case needsUpdate        // app below the remote minimum version
}

/// Combines remote flags, subscription state, and version compatibility into a
/// single decision — the heart of remote feature management. Pure + testable.
public struct FeatureGate: Sendable {
    public let flags: FeatureFlags
    public let isPro: Bool
    public let appVersion: String

    public init(flags: FeatureFlags, isPro: Bool, appVersion: String) {
        self.flags = flags; self.isPro = isPro; self.appVersion = appVersion
    }

    public func evaluate(_ feature: WatchFeature) -> GateResult {
        if flags.killSwitch { return .disabledRemotely }
        if flags.requiresUpdate(currentVersion: appVersion) { return .needsUpdate }
        if !flags.isEnabled(feature.rawValue) { return .disabledRemotely }
        if feature.requiresPro && !isPro { return .needsPro }
        return .allowed
    }

    public func allows(_ feature: WatchFeature) -> Bool { evaluate(feature) == .allowed }
}
