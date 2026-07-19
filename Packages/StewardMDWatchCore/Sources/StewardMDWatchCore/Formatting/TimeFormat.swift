import Foundation

/// Tabular-numeral time strings for timers and countdowns (design §11 — numerals
/// always tabular, AOD-safe). Deterministic and locale-independent.
public enum TimeFormat {
    /// `M:SS` (minutes unpadded, seconds zero-padded). Negatives clamp to 0.
    public static func mmss(_ seconds: TimeInterval) -> String {
        let t = Int(max(0, seconds))
        return String(format: "%d:%02d", t / 60, t % 60)
    }

    /// `H:MM:SS`. Negatives clamp to 0.
    public static func hmmss(_ seconds: TimeInterval) -> String {
        let t = Int(max(0, seconds))
        return String(format: "%d:%02d:%02d", t / 3600, (t % 3600) / 60, t % 60)
    }
}
