import XCTest
@testable import StewardMDWatchCore

final class CompressionAnalyzerTests: XCTestCase {
    private let dt = 1.0 / 50.0

    /// Signed vertical-acceleration sine at `cpm` (one oscillation per compression,
    /// as produced by projecting userAcceleration onto gravity).
    @discardableResult
    private func feedSine(_ a: inout CompressionAnalyzer, cpm: Double, seconds: Double,
                          amp: Double = 1.0, from t0: Double = 0) -> [AnalyzerTick] {
        let w = 2 * Double.pi * (cpm / 60.0)
        var ticks: [AnalyzerTick] = []
        var t = t0
        while t < t0 + seconds {
            ticks.append(a.ingest(CompressionSample(t: t, value: amp * sin(w * t))))
            t += dt
        }
        return ticks
    }

    func test_countsAndRate_at110cpm() {
        var a = CompressionAnalyzer()
        feedSine(&a, cpm: 110, seconds: 12)
        XCTAssertEqual(Double(a.state.count), 22, accuracy: 2)     // 110/min × 12 s = 22
        XCTAssertEqual(Double(a.state.averageRateCPM), 110, accuracy: 8)
        XCTAssertFalse(a.state.paused)
    }

    /// The core fix: one compression whose stroke has a secondary bump (down-thrust +
    /// recoil) must count ONCE, not twice. Each cycle here has a big main peak, a
    /// shallow dip (NOT past the low threshold), a secondary bump, then a deep trough.
    func test_secondaryBumpWithinStroke_isNotDoubleCounted() {
        var a = CompressionAnalyzer()
        let cpm = 110.0, period = 60.0 / cpm
        var t = 0.0
        // Prime the gate with clean compressions first.
        feedSine(&a, cpm: cpm, seconds: 4)
        t = 4.0
        let base = a.state.count
        // 10 compressions, each with a within-stroke secondary bump.
        for _ in 0..<10 {
            // main peak (+1.0), shallow dip to +0.2 (above low), secondary bump (+0.4),
            // then deep trough (−1.0) which re-arms for the next compression.
            let seg: [Double] = [1.0, 0.9, 0.5, 0.2, 0.35, 0.4, 0.3, 0.0, -0.6, -1.0, -0.6, 0.0]
            for v in seg { a.ingest(CompressionSample(t: t, value: v)); t += period / Double(seg.count) }
        }
        // ≈10 (one per stroke) — crucially NOT ≈20. ±1 for the synthetic priming seam.
        XCTAssertEqual(Double(a.state.count - base), 10, accuracy: 1, "each stroke must count once, not twice")
    }

    func test_singleBump_isRejectedByRepetitionGate() {
        var a = CompressionAnalyzer()
        _ = a.ingest(CompressionSample(t: 0.0, value: 0.0))
        _ = a.ingest(CompressionSample(t: 0.1, value: 1.5))   // one lone spike
        _ = a.ingest(CompressionSample(t: 0.2, value: 0.0))
        for i in 3...300 { _ = a.ingest(CompressionSample(t: Double(i) * dt, value: 0.02)) }
        XCTAssertEqual(a.state.count, 0)
    }

    func test_pauseDetectedAfterTimeout_thenResumes() {
        var a = CompressionAnalyzer()
        feedSine(&a, cpm: 110, seconds: 6)
        XCTAssertFalse(a.state.paused)
        var pausedSeen = false
        var t = 6.0
        while t < 10.0 { if a.ingest(CompressionSample(t: t, value: 0.0)).pauseStarted { pausedSeen = true }; t += dt }
        XCTAssertTrue(pausedSeen)
        XCTAssertTrue(a.state.paused)
        XCTAssertGreaterThan(a.state.pauseSeconds, 3.0)
        let ticks = feedSine(&a, cpm: 110, seconds: 4, from: 10.0)
        XCTAssertTrue(ticks.contains { $0.resumed })
        XCTAssertFalse(a.state.paused)
    }
}
