import XCTest
@testable import StewardMDWatchCore

final class PendingRouteTests: XCTestCase {
    func testConsumeOnce() {
        let suite = "test.smd.route.\(UUID().uuidString)"
        let store = AppGroupStore(suite: suite)
        XCTAssertNil(store.takePendingRoute())
        store.savePendingRoute("codeBlue")
        XCTAssertEqual(store.takePendingRoute(), "codeBlue")
        XCTAssertNil(store.takePendingRoute())          // consumed
        UserDefaults(suiteName: suite)?.removePersistentDomain(forName: suite)
    }
}
