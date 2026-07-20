import XCTest
@testable import StewardMDWatchCore

final class TimerEngineTests: XCTestCase {

    func testCodeBlueCycleIncrementsEveryTwoMinutes() {
        var t = CodeBlueTimer()
        XCTAssertEqual(t.cycle, 1)
        t.tick(119)
        XCTAssertEqual(t.cycle, 1)
        t.tick(1)                    // crosses 120s
        XCTAssertEqual(t.cycle, 2)
        XCTAssertEqual(t.secondsToNextRhythmCheck, 120, accuracy: 0.0001)
    }

    func testCodeBlueRhythmCheckCountdown() {
        var t = CodeBlueTimer()
        t.tick(30)
        XCTAssertEqual(t.secondsToNextRhythmCheck, 90, accuracy: 0.0001)
    }

    func testCodeBlueRhythmDueSignal() {
        var t = CodeBlueTimer()
        XCTAssertFalse(t.tick(119))   // no rhythm-check boundary crossed
        XCTAssertTrue(t.tick(1))      // crossed 120s → rhythm check due
    }

    func testSepsisCountdownFromOneHour() {
        var s = SepsisBundleTimer()
        XCTAssertEqual(s.remaining, 3600, accuracy: 0.0001)
        s.tick(300)                   // 5 min elapsed
        XCTAssertEqual(s.remaining, 3300, accuracy: 0.0001)
        XCTAssertFalse(s.isExpired)
    }

    func testSepsisExpiresAndClampsAtZero() {
        var s = SepsisBundleTimer()
        s.tick(4000)
        XCTAssertEqual(s.remaining, 0, accuracy: 0.0001)
        XCTAssertTrue(s.isExpired)
    }

    func testSepsisNudgeWindow() {
        var s = SepsisBundleTimer()
        s.tick(3600 - 599)            // 599s left → within final-10-min nudge window
        XCTAssertTrue(s.shouldNudge)
    }
}
