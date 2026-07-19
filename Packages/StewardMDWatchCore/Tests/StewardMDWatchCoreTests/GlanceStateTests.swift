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
