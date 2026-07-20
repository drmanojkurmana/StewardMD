import XCTest
@testable import StewardMDWatchCore

@MainActor
final class SepsisTimerModelTests: XCTestCase {
    func testChecklistToggleAndCompletion() {
        let m = SepsisTimerModel()
        XCTAssertFalse(m.allDone)
        for step in SepsisTimerModel.Step.allCases { m.toggle(step) }
        XCTAssertTrue(m.allDone)
        m.toggle(.cultures)
        XCTAssertFalse(m.allDone)
    }
    func testRemainingLabel() {
        let m = SepsisTimerModel()
        m.tick(300)
        XCTAssertEqual(m.remainingLabel, "55:00")
    }
    func testNudgeWindow() {
        let m = SepsisTimerModel()
        m.tick(3001)                     // 599s remaining → within final 10 min
        XCTAssertTrue(m.shouldNudge)
    }
    func testProgress() {
        let m = SepsisTimerModel()
        m.toggle(.cultures); m.toggle(.lactate)
        XCTAssertEqual(m.progress, 0.5, accuracy: 0.0001)
    }
}

@MainActor
final class ProcedureStopwatchTests: XCTestCase {
    func testCountsUpOnlyWhenRunning() {
        let m = ProcedureStopwatch()
        m.tick(5); XCTAssertEqual(m.elapsed, 0)   // not started
        m.start(); m.tick(5); XCTAssertEqual(m.elapsed, 5)
        m.stop(); m.tick(5); XCTAssertEqual(m.elapsed, 5)
    }
    func testLabelAndReset() {
        let m = ProcedureStopwatch()
        m.start(); m.tick(84)
        XCTAssertEqual(m.label, "1:24")
        m.reset(); XCTAssertEqual(m.elapsed, 0); XCTAssertFalse(m.running)
    }
}
