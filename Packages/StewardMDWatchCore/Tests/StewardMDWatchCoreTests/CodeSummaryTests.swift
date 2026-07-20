import XCTest
@testable import StewardMDWatchCore

final class CodeSummaryTests: XCTestCase {
    private func ev(_ e: TimeInterval, _ k: CodeEventKind, _ label: String = "") -> CodeEvent {
        CodeEvent(id: "\(k.rawValue)-\(e)", elapsed: e, kind: k, label: label, sourceDeviceId: "watch")
    }

    func test_build_aggregatesPausesShocksDrugs() {
        let events: [CodeEvent] = [
            ev(0, .cprStart),
            ev(30, .shock, "Shock #1"),
            ev(45, .drug, "Epinephrine"),
            ev(60, .pauseStart), ev(64, .resume),          // 4 s pause
            ev(120, .switchCompressor),
            ev(130, .pauseStart), ev(142, .resume),        // 12 s pause (longest)
            ev(150, .shock, "Shock #2"),
            ev(200, .rosc),
            ev(210, .cprEnd),
        ]
        let s = CodeSummary.build(events: events, durationSeconds: 210,
                                  cycles: 2, totalCompressions: 340, averageRateCPM: 112)
        XCTAssertEqual(s.totalCompressions, 340)
        XCTAssertEqual(s.averageRateCPM, 112)
        XCTAssertEqual(s.shockCount, 2)
        XCTAssertEqual(s.shocks.count, 2)
        XCTAssertEqual(s.drugs.count, 1)
        XCTAssertEqual(s.pauseCount, 2)
        XCTAssertEqual(s.totalPauseSeconds, 16, accuracy: 0.001)
        XCTAssertEqual(s.longestPauseSeconds, 12, accuracy: 0.001)
        XCTAssertEqual(s.compressionFractionPct, 92)   // (210 − 16) / 210 ≈ 92%
        XCTAssertTrue(s.rosc)
        XCTAssertEqual(s.durationLabel, "3:30")
        XCTAssertTrue(s.disclaimer.contains("not a measure of CPR quality"))
        XCTAssertTrue(s.formattedDetail().contains("Shock #1"))
    }

    func test_codeBlueState_roundTripsCodable() throws {
        let st = CodeBlueState(running: true, elapsed: 42, cycle: 1, compressionCount: 70,
                               instantaneousRateCPM: 110, averageRateCPM: 108, coachZone: .onTarget,
                               paused: false, pauseSeconds: 0, adrenalineCount: 1, shockCount: 1,
                               rosc: false, batteryLevel: 0.8, events: [ev(0, .cprStart)],
                               updatedElapsed: 42)
        let data = try JSONEncoder().encode(st)
        let back = try JSONDecoder().decode(CodeBlueState.self, from: data)
        XCTAssertEqual(st, back)
    }
}
