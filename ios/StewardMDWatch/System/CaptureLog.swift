import Foundation

/// DEV-only capture: records the raw per-sample vertical-acceleration trace during a
/// code so the compression detector can be tuned against real CPR motion. Off by
/// default. On stop it prints a replayable JSON block to the Xcode console between
/// `=== SMD-CAPTURE-BEGIN ===` / `=== SMD-CAPTURE-END ===` markers. Timestamps are
/// rebased to start at 0 so the trace can be replayed straight through
/// `CompressionAnalyzer` in a unit test.
@MainActor
final class CaptureLog {
    static let shared = CaptureLog()
    private(set) var enabled = false
    private var buf: [(Double, Double)] = []
    private let maxSamples = 6000     // ~2 min @ 50 Hz — bounds memory
    private init() {}

    func begin() { buf.removeAll(keepingCapacity: true); enabled = true }

    func record(_ t: Double, _ v: Double) {
        guard enabled else { return }
        if buf.count >= maxSamples { buf.removeFirst(buf.count - maxSamples + 1) }
        buf.append((t, v))
    }

    /// Stop recording, print the trace, and return a one-line summary for the UI.
    @discardableResult
    func end(appCount: Int) -> String {
        enabled = false
        let n = buf.count
        let t0 = buf.first?.0 ?? 0
        let samples = buf.map { "[\(round3($0.0 - t0)),\(round3($0.1))]" }.joined(separator: ",")
        print("=== SMD-CAPTURE-BEGIN ===")
        print("{\"hz\":50,\"appCount\":\(appCount),\"n\":\(n),\"samples\":[\(samples)]}")
        print("=== SMD-CAPTURE-END ===")
        return "Captured \(n) samples · app counted \(appCount) · trace in Xcode console"
    }

    private func round3(_ x: Double) -> Double { (x * 1000).rounded() / 1000 }
}
