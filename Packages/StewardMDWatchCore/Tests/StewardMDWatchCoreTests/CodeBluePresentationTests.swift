import XCTest
@testable import StewardMDWatchCore

final class CodeBluePresentationTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1000)
    func testReachabilityAloneDoesNotMakeSavedStateLive() {
        var state = CodeBlueState.empty; state.running = true
        let p = CodeBluePresentation(state: state, connected: true, receivedAt: nil, now: now)
        XCTAssertFalse(p.isFresh)
        XCTAssertEqual(p.status, "Awaiting watch update")
        XCTAssertTrue(p.syncLabel.contains("unknown"))
    }
    func testFreshnessExpiresEvenIfReachabilityStaysTrue() {
        var state = CodeBlueState.empty; state.running = true
        XCTAssertTrue(CodeBluePresentation(state: state, connected: true, receivedAt: now.addingTimeInterval(-9), now: now).isFresh)
        XCTAssertFalse(CodeBluePresentation(state: state, connected: true, receivedAt: now.addingTimeInterval(-10), now: now).isFresh)
        XCTAssertFalse(CodeBluePresentation(state: state, connected: false, receivedAt: now, now: now).isFresh)
    }
    func testPhoneWallTimeNeverAdvancesRhythmCountdown() {
        var state = CodeBlueState.empty; state.running = true; state.elapsed = 119
        let p = CodeBluePresentation(state: state, connected: false, receivedAt: now.addingTimeInterval(-30), now: now)
        XCTAssertEqual(p.rhythmCountdown, "0:01")
        state.elapsed = 120
        XCTAssertEqual(CodeBluePresentation(state: state, connected: true, receivedAt: now, now: now).rhythmCountdown, "2:00")
    }
    func testIdleAndEndedAreDistinct() {
        XCTAssertEqual(CodeBluePresentation(state: .empty, connected: false, receivedAt: nil, now: now).status, "Ready to receive")
        var state = CodeBlueState.empty
        state.events = [.init(id: "end", elapsed: 10, kind: .cprEnd, label: "", sourceDeviceId: "watch")]
        XCTAssertEqual(CodeBluePresentation(state: state, connected: false, receivedAt: nil, now: now).status, "Code ended")
    }
    func testMergedTimelineOwnsCountersAndROSC() {
        var state = CodeBlueState.empty; state.shockCount = 99
        state.events = [
            .init(id: "s", elapsed: 1, kind: .shock, label: "", sourceDeviceId: "phone"),
            .init(id: "d", elapsed: 2, kind: .drug, label: "Adrenaline", sourceDeviceId: "watch"),
            .init(id: "r", elapsed: 3, kind: .rosc, label: "ROSC", sourceDeviceId: "phone")
        ]
        let p = CodeBluePresentation(state: state, connected: false, receivedAt: nil, now: now)
        XCTAssertEqual(p.shockCount, 1); XCTAssertEqual(p.epinephrineCount, 1)
        XCTAssertTrue(p.roscRecorded)
    }
}
