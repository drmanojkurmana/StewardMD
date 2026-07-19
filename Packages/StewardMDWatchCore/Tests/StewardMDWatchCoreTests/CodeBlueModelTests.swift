import XCTest
@testable import StewardMDWatchCore

@MainActor
final class CodeBlueModelTests: XCTestCase {
    func testCycleAndRhythmDueAfterTwoMinutes() {
        let m = CodeBlueModel()
        XCTAssertFalse(m.tick(119))
        XCTAssertEqual(m.cycle, 1)
        XCTAssertTrue(m.tick(1))              // crosses 120s
        XCTAssertEqual(m.cycle, 2)
    }

    func testLabels() {
        let m = CodeBlueModel()
        m.tick(84)
        XCTAssertEqual(m.elapsedLabel, "1:24")
        // 84s into a 120s cycle → 36s to next rhythm check
        XCTAssertEqual(m.rhythmCountdownLabel, "0:36")
    }

    func testAdrenalineScheduleByCycleParity() {
        let m = CodeBlueModel()
        XCTAssertEqual(m.nextDrug, "Adrenaline 1 mg")     // cycle 1 (odd)
        m.tick(121)                                       // cycle 2 (even)
        XCTAssertTrue(m.nextDrug.contains("Amiodarone"))
    }

    func testSummaryCountsAndROSC() {
        let m = CodeBlueModel()
        m.tick(600)                 // 10 min
        m.recordAdrenaline()
        m.recordAdrenaline()
        m.recordShock()
        m.markROSC()
        let s = m.end()
        XCTAssertEqual(s.adrenalineCount, 2)
        XCTAssertEqual(s.shockCount, 1)
        XCTAssertTrue(s.rosc)
        XCTAssertEqual(s.durationLabel, "10:00")
        XCTAssertEqual(s.cycles, 6)  // 600 / 120 + 1
    }
}
