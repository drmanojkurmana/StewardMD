import XCTest
@testable import StewardMDWatchCore

final class RateCoachTests: XCTestCase {
    func test_zoneBoundaries() {
        XCTAssertEqual(RateCoach.zone(forRateCPM: 99, active: true), .tooSlow)
        XCTAssertEqual(RateCoach.zone(forRateCPM: 100, active: true), .onTarget)
        XCTAssertEqual(RateCoach.zone(forRateCPM: 120, active: true), .onTarget)
        XCTAssertEqual(RateCoach.zone(forRateCPM: 121, active: true), .tooFast)
    }
    func test_idleWhenNotActive() {
        XCTAssertEqual(RateCoach.zone(forRateCPM: 110, active: false), .idle)
        XCTAssertEqual(RateCoach.zone(forRateCPM: 0, active: true), .idle)
    }
    func test_guidanceCopyIsNeutral() {
        XCTAssertEqual(RateCoach.guidance(.tooSlow), "Faster")
        XCTAssertEqual(RateCoach.guidance(.onTarget), "On target")
        XCTAssertEqual(RateCoach.guidance(.tooFast), "Slower")
        // never a quality verdict
        XCTAssertFalse(RateCoach.guidance(.onTarget).lowercased().contains("good"))
    }
}
