import Foundation

/// End-of-code summary (design §2). Aggregated purely from the event timeline +
/// measured stats — no quality judgement, no depth.
public struct CodeSummary: Codable, Sendable, Equatable {
    public let durationLabel: String
    public let durationSeconds: TimeInterval
    public let cycles: Int
    public let totalCompressions: Int
    public let averageRateCPM: Int
    public let pauseCount: Int
    public let totalPauseSeconds: TimeInterval
    public let longestPauseSeconds: TimeInterval
    public let adrenalineCount: Int
    public let shockCount: Int
    public let shocks: [CodeEvent]
    public let drugs: [CodeEvent]
    public let rosc: Bool
    public let targetRatePct: Int      // % of active time in the 100–120 band (measured)
    public let disclaimer: String

    public static let disclaimerText =
        "Motion-based estimates — not a measure of CPR quality or depth."

    /// Chest-Compression Fraction — the % of the code spent actively compressing
    /// (not paused). A measurable *process* metric (guideline-endorsed) — NOT a depth
    /// or CPR-quality judgement. Estimate: pauses shorter than the detector's pause
    /// threshold count as active, so this reads slightly high for very brief hands-off.
    public var compressionFractionPct: Int {
        guard durationSeconds > 0 else { return 0 }
        let active = max(0, durationSeconds - totalPauseSeconds)
        return Int((min(1, active / durationSeconds) * 100).rounded())
    }

    /// Aggregate a summary from the raw event timeline + measured compression stats.
    public static func build(events: [CodeEvent], durationSeconds: TimeInterval,
                             cycles: Int, totalCompressions: Int,
                             averageRateCPM: Int, targetRatePct: Int = 0) -> CodeSummary {
        let shocks = events.filter { $0.kind == .shock }
        let drugs = events.filter { $0.kind == .drug }
        let adren = drugs.filter { $0.label.lowercased().contains("epinephrine")
            || $0.label.lowercased().contains("adrenaline") }.count

        // Pair each pauseStart with the next resume to measure pause durations.
        var pauses: [TimeInterval] = []
        var pendingPause: TimeInterval?
        for e in events.sorted(by: { $0.elapsed < $1.elapsed }) {
            if e.kind == .pauseStart { pendingPause = e.elapsed }
            else if e.kind == .resume, let start = pendingPause {
                pauses.append(max(0, e.elapsed - start)); pendingPause = nil
            }
        }
        return CodeSummary(
            durationLabel: TimeFormat.mmss(durationSeconds),
            durationSeconds: durationSeconds, cycles: cycles,
            totalCompressions: totalCompressions, averageRateCPM: averageRateCPM,
            pauseCount: pauses.count, totalPauseSeconds: pauses.reduce(0, +),
            longestPauseSeconds: pauses.max() ?? 0, adrenalineCount: adren,
            shockCount: shocks.count, shocks: shocks, drugs: drugs,
            rosc: events.contains { $0.kind == .rosc }, targetRatePct: targetRatePct,
            disclaimer: disclaimerText)
    }

    /// Human-readable multi-line export body (used by the phone opt-in Export).
    public func formattedDetail() -> String {
        var lines = ["Code Blue summary", "Duration \(durationLabel) · \(cycles) cycles",
                     "Compressions \(totalCompressions) (avg ~\(averageRateCPM)/min, est.)",
                     "Pauses \(pauseCount) · total \(TimeFormat.mmss(totalPauseSeconds)) · longest \(TimeFormat.mmss(longestPauseSeconds))",
                     "Compression fraction ~\(compressionFractionPct)% of code (est.)",
                     "Rate on target ~\(targetRatePct)% of active time (est.)"]
        for s in shocks { lines.append("\(TimeFormat.mmss(s.elapsed)) — \(s.label.isEmpty ? "Shock" : s.label)") }
        for d in drugs { lines.append("\(TimeFormat.mmss(d.elapsed)) — \(d.label)") }
        lines.append(rosc ? "ROSC achieved" : "No ROSC recorded")
        lines.append(disclaimer)
        return lines.joined(separator: "\n")
    }

    /// Full chronological code record ("code sheet") for the chart — every event with
    /// its time, plus the measured process metrics. Advisory; review before filing.
    public func codeSheet(events: [CodeEvent], header: String = "") -> String {
        var lines: [String] = []
        if !header.isEmpty { lines.append(header) }
        lines.append("STEWARDMD CODE BLUE RECORD")
        lines.append("Duration \(durationLabel) · \(cycles) rhythm cycles")
        lines.append("Compressions \(totalCompressions) · avg ~\(averageRateCPM)/min (est.) · on target ~\(targetRatePct)%")
        lines.append("Compression fraction ~\(compressionFractionPct)% · pauses \(pauseCount) (longest \(TimeFormat.mmss(longestPauseSeconds)))")
        lines.append("Shocks \(shockCount) · Epinephrine doses \(adrenalineCount) · \(rosc ? "ROSC achieved" : "No ROSC")")
        lines.append("")
        lines.append("TIMELINE")
        for e in events.sorted(by: { $0.elapsed < $1.elapsed }) {
            lines.append("\(TimeFormat.mmss(e.elapsed))  \(Self.codeLabel(e))")
        }
        lines.append("")
        lines.append(disclaimer)
        return lines.joined(separator: "\n")
    }

    static func codeLabel(_ e: CodeEvent) -> String {
        switch e.kind {
        case .cprStart: return "CPR started"
        case .cprEnd: return "CPR ended"
        case .shock: return e.label.isEmpty ? "Shock" : e.label
        case .drug: return "Drug — \(e.label)"
        case .rhythm: return "Rhythm — \(e.label)"
        case .pauseStart: return "Paused"
        case .resume: return "Resumed"
        case .switchCompressor: return "Switch compressor"
        case .rosc: return "ROSC"
        }
    }
}
