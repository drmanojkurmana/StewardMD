import XCTest
@testable import StewardMDWatchCore

final class GlanceStateTests: XCTestCase {
    func testRoundTrip() throws {
        let g = GlanceState(criticalCount: 3, topCritical: "K⁺ 6.8 · Bed 12",
                            patientCount: 12, tasksDue: 3, roundsDone: 8, roundsTotal: 12,
                            censusOccupied: 28, censusTotal: 32, shiftEndsAt: 1000,
                            onCall: true, ward: "Ward 7", bleep: "2231", updatedAt: 5)
        let back = try JSONDecoder().decode(GlanceState.self, from: JSONEncoder().encode(g))
        XCTAssertEqual(back, g)
    }

    func testMergedPreservesWatchOwnedFieldsAndAppliesPhoneFields() {
        // Watch owns criticalCount (push-driven); a relay must not clobber it.
        let existing = GlanceState(criticalCount: 3, topCritical: "K⁺ 6.8", patientCount: 0)
        let merged = existing.merged(with: [
            "patientCount": 12, "censusOccupied": 10, "censusTotal": 12,
            "onCall": true, "ward": "Ward 7", "updatedAt": 5.0
        ])
        XCTAssertEqual(merged.criticalCount, 3)          // preserved
        XCTAssertEqual(merged.topCritical, "K⁺ 6.8")     // preserved
        XCTAssertEqual(merged.patientCount, 12)          // applied
        XCTAssertEqual(merged.censusOccupied, 10)
        XCTAssertTrue(merged.onCall)
        XCTAssertEqual(merged.ward, "Ward 7")
        XCTAssertEqual(merged.updatedAt, 5.0, accuracy: 0.001)
    }

    func testMergedIgnoresAbsentKeys() {
        let existing = GlanceState(criticalCount: 2, patientCount: 9, ward: "ICU")
        let merged = existing.merged(with: ["onCall": true])
        XCTAssertEqual(merged.patientCount, 9)   // untouched (not in dict)
        XCTAssertEqual(merged.ward, "ICU")       // untouched
        XCTAssertTrue(merged.onCall)             // applied
    }

    func testAppGroupGlanceRoundTrip() {
        let suite = "test.smd.glance.\(UUID().uuidString)"
        let store = AppGroupStore(suite: suite)
        XCTAssertEqual(store.loadGlance(), .empty)   // absent → empty
        let g = GlanceState.empty.with(criticalCount: 2)
        store.saveGlance(g)
        XCTAssertEqual(store.loadGlance().criticalCount, 2)
        UserDefaults(suiteName: suite)?.removePersistentDomain(forName: suite)
    }
}
