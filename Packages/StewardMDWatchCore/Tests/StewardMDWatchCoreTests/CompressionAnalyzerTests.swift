import XCTest
@testable import StewardMDWatchCore

final class CompressionAnalyzerTests: XCTestCase {
    /// Feed a sine wave at `cpm` compressions/min for `seconds`, sampled at 50 Hz.
    /// Amplitude ~1.2 g peak (typical wrist userAcceleration magnitude during CPR).
    @discardableResult
    private func feedSine(_ a: inout CompressionAnalyzer, cpm: Double, seconds: Double,
                          amp: Double = 1.2, from t0: Double = 0) -> [AnalyzerTick] {
        let dt = 1.0 / 50.0
        let w = 2 * Double.pi * (cpm / 60.0)
        var ticks: [AnalyzerTick] = []
        var t = t0
        let end = t0 + seconds
        while t < end {
            let mag = amp * (0.5 + 0.5 * sin(w * t))   // 0…amp, one peak per cycle
            ticks.append(a.ingest(CompressionSample(t: t, magnitude: mag)))
            t += dt
        }
        return ticks
    }

    func test_countsAndRate_at110cpm() {
        var a = CompressionAnalyzer()
        feedSine(&a, cpm: 110, seconds: 12)
        // 110 cpm × 12 s = 22 compressions; allow ±2 for edge/gate.
        XCTAssertEqual(Double(a.state.count), 22, accuracy: 2)
        XCTAssertEqual(Double(a.state.averageRateCPM), 110, accuracy: 8)
        XCTAssertFalse(a.state.paused)
    }

    func test_singleBump_isRejectedByRepetitionGate() {
        var a = CompressionAnalyzer()
        // one lone peak then quiet → never arms → count stays 0
        _ = a.ingest(CompressionSample(t: 0.0, magnitude: 0.1))
        _ = a.ingest(CompressionSample(t: 0.1, magnitude: 1.5))
        _ = a.ingest(CompressionSample(t: 0.2, magnitude: 0.1))
        for i in 3...200 { _ = a.ingest(CompressionSample(t: Double(i) * 0.02, magnitude: 0.05)) }
        XCTAssertEqual(a.state.count, 0)
    }

    func test_pauseDetectedAfterTimeout_thenResumes() {
        var a = CompressionAnalyzer()
        feedSine(&a, cpm: 110, seconds: 6)                 // establish rhythm
        XCTAssertFalse(a.state.paused)
        // 4 s of silence → pause (timeout 3 s)
        var pausedSeen = false
        var t = 6.0
        while t < 10.0 { let tk = a.ingest(CompressionSample(t: t, magnitude: 0.02)); if tk.pauseStarted { pausedSeen = true }; t += 0.02 }
        XCTAssertTrue(pausedSeen)
        XCTAssertTrue(a.state.paused)
        XCTAssertGreaterThan(a.state.pauseSeconds, 3.0)
        // resume compressions → resumed flag fires, paused clears
        let ticks = feedSine(&a, cpm: 110, seconds: 4, from: 10.0)
        XCTAssertTrue(ticks.contains { $0.resumed })
        XCTAssertFalse(a.state.paused)
    }
}
