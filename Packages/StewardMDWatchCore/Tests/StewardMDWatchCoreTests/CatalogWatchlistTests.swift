import XCTest
@testable import StewardMDWatchCore

final class CalculatorCatalogTests: XCTestCase {
    func testCatalogHasWristCalculators() {
        let ids = Set(CalculatorCatalog.all.map(\.id))
        XCTAssertTrue(ids.isSuperset(of: ["qsofa", "news2", "gcs", "shock"]))
    }
    func testFavoriteConversion() {
        let def = CalculatorCatalog.all.first { $0.id == "qsofa" }!
        XCTAssertEqual(def.asFavorite.kind, .calculator)
        XCTAssertEqual(def.asFavorite.id, "qsofa")
    }
}

@MainActor
final class WatchlistModelTests: XCTestCase {
    private func e(_ id: String, _ n: Int) -> WatchlistEntry {
        WatchlistEntry(id: id, name: id, bed: nil, news2: n, flag: nil, updatedAt: nil)
    }
    func testRanksSickestFirst() {
        let m = WatchlistModel()
        m.set([e("a", 2), e("b", 9), e("c", 6)])
        XCTAssertEqual(m.entries.map(\.id), ["b", "c", "a"])
    }
    func testFlaggedCount() {
        let m = WatchlistModel()
        m.set([e("a", 2), e("b", 9), e("c", 6)])   // 9 critical, 6 warning → 2 flagged
        XCTAssertEqual(m.flaggedCount, 2)
    }

    private func u(_ id: String, _ n: Int, unit: String?, kind: String?) -> WatchlistEntry {
        WatchlistEntry(id: id, name: id, bed: nil, news2: n, flag: nil, updatedAt: nil, unit: unit, unitKind: kind)
    }

    func testUnitGroupsOrderICUFirstThenWard() {
        let m = WatchlistModel()
        m.set([u("w1", 8, unit: "Gastro ward", kind: "ward"),
               u("i1", 3, unit: "ICU", kind: "icu"),
               u("w2", 5, unit: "Gastro ward", kind: "ward")])
        let g = m.unitGroups
        XCTAssertEqual(g.map(\.id), ["ICU", "Gastro ward"])          // ICU-kind first
        XCTAssertEqual(g.first?.entries.map(\.id), ["i1"])
        XCTAssertEqual(g.last?.entries.map(\.id), ["w1", "w2"])       // severity order kept
    }

    func testUntaggedPatientsGoLast() {
        let m = WatchlistModel()
        m.set([u("x", 9, unit: nil, kind: nil), u("i1", 2, unit: "ICU", kind: "icu")])
        let g = m.unitGroups
        XCTAssertEqual(g.map(\.id), ["ICU", "Current"])
    }
}
