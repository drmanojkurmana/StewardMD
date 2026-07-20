import Foundation

/// A single timestamped Code Blue event (design §2). `elapsed` is seconds since
/// CPR start so events order/merge deterministically regardless of wall clock.
/// `sourceDeviceId` tags the originating device so a future multi-source timeline
/// merges cleanly (single source — "watch" — today).
public enum CodeEventKind: String, Codable, Sendable {
    case cprStart, shock, drug, pauseStart, resume, switchCompressor, rosc, cprEnd
}

public struct CodeEvent: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public let elapsed: TimeInterval
    public let kind: CodeEventKind
    public let label: String
    public let sourceDeviceId: String
    public init(id: String, elapsed: TimeInterval, kind: CodeEventKind,
                label: String, sourceDeviceId: String) {
        self.id = id; self.elapsed = elapsed; self.kind = kind
        self.label = label; self.sourceDeviceId = sourceDeviceId
    }
}

/// CPR compression-rate coaching zone against the AHA 100–120 cpm band. Neutral
/// rate-matching guidance only — NEVER a CPR-quality verdict (design safety §0).
public enum RateZone: String, Codable, Sendable { case idle, tooSlow, onTarget, tooFast }
