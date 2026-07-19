import XCTest
@testable import StewardMDWatchCore

@MainActor
final class FavoritesStoreTests: XCTestCase {
    private func store() -> FavoritesStore {
        let suite = "test.smd.fav.\(UUID().uuidString)"
        return FavoritesStore(appGroup: AppGroupStore(suite: suite))
    }

    func testToggleAddsAndRemoves() {
        let s = store()
        let f = Favorite(id: "qsofa", kind: .calculator, label: "qSOFA")
        XCTAssertFalse(s.isFavorite("qsofa"))
        s.toggle(f)
        XCTAssertTrue(s.isFavorite("qsofa"))
        s.toggle(f)
        XCTAssertFalse(s.isFavorite("qsofa"))
    }

    func testPersistsAcrossInstances() {
        let suite = "test.smd.fav.\(UUID().uuidString)"
        let s1 = FavoritesStore(appGroup: AppGroupStore(suite: suite))
        s1.toggle(Favorite(id: "news2", kind: .calculator, label: "NEWS2"))
        let s2 = FavoritesStore(appGroup: AppGroupStore(suite: suite))
        XCTAssertTrue(s2.isFavorite("news2"))
        UserDefaults(suiteName: suite)?.removePersistentDomain(forName: suite)
    }
}
