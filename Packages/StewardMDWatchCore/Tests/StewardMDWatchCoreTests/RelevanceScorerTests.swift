import XCTest
@testable import StewardMDWatchCore

final class RelevanceScorerTests: XCTestCase {
    private func top(_ scores: [WidgetKind: Double]) -> WidgetKind? {
        scores.max { $0.value < $1.value }?.key
    }

    func testCriticalsDominate() {
        let s = RelevanceScorer.score(GlanceState(criticalCount: 3), hour: 14)
        XCTAssertEqual(top(s), .criticalLabs)
        XCTAssertEqual(s[.criticalLabs], 1.0)
    }

    func testNoCriticalsLowersCriticalScore() {
        let s = RelevanceScorer.score(GlanceState(criticalCount: 0), hour: 14)
        XCTAssertLessThan(s[.criticalLabs] ?? 1, 0.5)
    }

    func testShiftRisesNearEnd() {
        // shift ends at t=6000; "now" 30 min before → within 90-min window
        let state = GlanceState(shiftEndsAt: 6000)
        let s = RelevanceScorer.score(state, hour: 21, now: Date(timeIntervalSince1970: 6000 - 1800))
        XCTAssertGreaterThanOrEqual(s[.shift] ?? 0, 0.8)
    }

    func testShiftLowWhenFarFromEnd() {
        let state = GlanceState(shiftEndsAt: 100_000)
        let s = RelevanceScorer.score(state, hour: 10, now: Date(timeIntervalSince1970: 0))
        XCTAssertLessThan(s[.shift] ?? 1, 0.5)
    }

    func testOnCallHigh() {
        let s = RelevanceScorer.score(GlanceState(onCall: true), hour: 3)
        XCTAssertGreaterThanOrEqual(s[.onCall] ?? 0, 0.85)
    }

    func testRoundsHigherMidMorning() {
        let morning = RelevanceScorer.score(GlanceState(roundsTotal: 12), hour: 9)[.rounds] ?? 0
        let evening = RelevanceScorer.score(GlanceState(roundsTotal: 12), hour: 20)[.rounds] ?? 0
        XCTAssertGreaterThan(morning, evening)
    }

    func testAllKindsScored() {
        let s = RelevanceScorer.score(.empty, hour: 12)
        XCTAssertEqual(Set(s.keys), Set(WidgetKind.allCases))
    }
}
