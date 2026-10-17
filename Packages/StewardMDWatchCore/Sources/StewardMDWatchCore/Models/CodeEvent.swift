import Foundation

/// A single timestamped Code Blue event (design §2). `elapsed` is seconds since
/// CPR start so events order/merge deterministically regardless of wall clock.
/// `sourceDeviceId` tags the originating device so a future multi-source timeline
/// merges cleanly (single source — "watch" — today).
public enum CodeEventKind: String, Codable, Sendable {
    case cprStart, shock, drug, pauseStart, resume, switchCompressor, rosc, cprEnd, rhythm
    // v2 additions, additive and backward compatible (old JSON still decodes).
    case procedure, reArrest, note, modeSet
}

public struct CodeEvent: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public let elapsed: TimeInterval
    public let kind: CodeEventKind
    public let label: String
    public let sourceDeviceId: String
    /// True once the row was edited in the log. Absent in old JSON, decodes as false.
    public let edited: Bool
    public init(id: String, elapsed: TimeInterval, kind: CodeEventKind,
                label: String, sourceDeviceId: String, edited: Bool = false) {
        self.id = id; self.elapsed = elapsed; self.kind = kind
        self.label = label; self.sourceDeviceId = sourceDeviceId; self.edited = edited
    }

    private enum CodingKeys: String, CodingKey {
        case id, elapsed, kind, label, sourceDeviceId, edited
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        elapsed = try c.decode(TimeInterval.self, forKey: .elapsed)
        kind = try c.decode(CodeEventKind.self, forKey: .kind)
        label = try c.decode(String.self, forKey: .label)
        sourceDeviceId = try c.decode(String.self, forKey: .sourceDeviceId)
        edited = try c.decodeIfPresent(Bool.self, forKey: .edited) ?? false
    }
    // encode(to:) is synthesised.
}

/// CPR compression-rate coaching zone against the AHA 100–120 cpm band. Neutral
/// rate-matching guidance only — NEVER a CPR-quality verdict (design safety §0).
public enum RateZone: String, Codable, Sendable { case idle, tooSlow, onTarget, tooFast }
