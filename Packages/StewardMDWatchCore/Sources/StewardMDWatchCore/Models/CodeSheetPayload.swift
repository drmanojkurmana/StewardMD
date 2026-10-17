import Foundation

/// v2 code sheet JSON payload, identical on all platforms (spec):
/// {"v":2,"mode":"adult","startedAt":"ISO-8601","durationSeconds":N,"cycles":N,
///  "events":[{"id","elapsed","kind","label","edited"}],
///  "summary":{"compressions":N,"averageRateCPM":N,"compressionFractionPct":N,
///  "targetRatePct":N,"shockCount":N,"adrenalineCount":N,"rosc":bool},
///  "disclaimer":"..."}.
/// Plain-text rendering is the shared fallback.
public struct CodeSheetPayload: Codable, Equatable, Sendable {
    public var v: Int
    public var mode: String
    public var startedAt: String
    public var durationSeconds: Int
    public var cycles: Int
    public var events: [CodeSheetEvent]
    public var summary: CodeSheetSummary
    public var disclaimer: String

    public init(v: Int = 2,
                mode: String,
                startedAt: String,
                durationSeconds: Int,
                cycles: Int,
                events: [CodeSheetEvent],
                summary: CodeSheetSummary,
                disclaimer: String = CodeSummary.disclaimerText) {
        self.v = v; self.mode = mode; self.startedAt = startedAt
        self.durationSeconds = durationSeconds; self.cycles = cycles
        self.events = events; self.summary = summary; self.disclaimer = disclaimer
    }
}

public struct CodeSheetEvent: Codable, Equatable, Sendable {
    public var id: String
    public var elapsed: TimeInterval
    public var kind: String
    public var label: String
    public var edited: Bool

    public init(id: String, elapsed: TimeInterval, kind: String, label: String, edited: Bool) {
        self.id = id; self.elapsed = elapsed; self.kind = kind
        self.label = label; self.edited = edited
    }
}

public struct CodeSheetSummary: Codable, Equatable, Sendable {
    public var compressions: Int
    public var averageRateCPM: Int
    public var compressionFractionPct: Int
    public var targetRatePct: Int
    public var shockCount: Int
    public var adrenalineCount: Int
    public var rosc: Bool

    public init(compressions: Int, averageRateCPM: Int, compressionFractionPct: Int,
                targetRatePct: Int, shockCount: Int, adrenalineCount: Int, rosc: Bool) {
        self.compressions = compressions; self.averageRateCPM = averageRateCPM
        self.compressionFractionPct = compressionFractionPct; self.targetRatePct = targetRatePct
        self.shockCount = shockCount; self.adrenalineCount = adrenalineCount; self.rosc = rosc
    }
}

public enum CodeSheet: Sendable {
    private static func isoString(from date: Date) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f.string(from: date)
    }

    public static func payload(summary: CodeSummary,
                               events: [CodeEvent],
                               mode: CodeMode,
                               startedAt: Date,
                               durationSeconds: TimeInterval,
                               cycles: Int) -> CodeSheetPayload {
        CodeSheetPayload(
            mode: mode.rawValue,
            startedAt: isoString(from: startedAt),
            durationSeconds: Int(durationSeconds),
            cycles: cycles,
            events: events.sorted(by: { $0.elapsed < $1.elapsed }).map {
                CodeSheetEvent(id: $0.id, elapsed: $0.elapsed, kind: $0.kind.rawValue,
                               label: $0.label, edited: $0.edited)
            },
            summary: CodeSheetSummary(
                compressions: summary.totalCompressions,
                averageRateCPM: summary.averageRateCPM,
                compressionFractionPct: summary.compressionFractionPct,
                targetRatePct: summary.targetRatePct,
                shockCount: summary.shockCount,
                adrenalineCount: summary.adrenalineCount,
                rosc: summary.rosc))
    }

    /// Encodes the v2 payload with sorted keys for stable output.
    public static func jsonData(summary: CodeSummary,
                                events: [CodeEvent],
                                mode: CodeMode,
                                startedAt: Date,
                                durationSeconds: TimeInterval,
                                cycles: Int) throws -> Data {
        let enc = JSONEncoder()
        enc.outputFormatting = [.sortedKeys]
        return try enc.encode(payload(summary: summary, events: events, mode: mode,
                                      startedAt: startedAt, durationSeconds: durationSeconds,
                                      cycles: cycles))
    }

    /// Plain-text rendering of the same record, the shared fallback.
    public static func plainText(summary: CodeSummary,
                                 events: [CodeEvent],
                                 mode: CodeMode,
                                 startedAt: Date) -> String {
        let header = "\(isoString(from: startedAt)) · \(mode.displayName)"
        return summary.codeSheet(events: events, header: header)
    }
}
