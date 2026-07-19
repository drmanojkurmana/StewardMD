import XCTest
@testable import StewardMDWatchCore

@MainActor
final class ABGModelTests: XCTestCase {
    func testWorkedExampleMetabolicAcidosis() {
        let m = ABGModel()
        m.pH.set(7.28); m.pCO2.set(3.1); m.hco3.set(14)
        XCTAssertEqual(m.result.primary, .metabolicAcidosis)
        XCTAssertTrue(m.summaryLine.contains("Metabolic acidosis"))
    }
    func testNormalDefault() {
        let m = ABGModel()
        XCTAssertEqual(m.result.primary, .normal)
    }
}

@MainActor
final class HandoverModelTests: XCTestCase {
    private func e(_ id: String, _ n: Int) -> WatchlistEntry {
        WatchlistEntry(id: id, name: id, bed: nil, news2: n, flag: nil, updatedAt: nil)
    }
    func testFlaggedFirstOrdering() {
        let m = HandoverModel()
        m.assemble(from: [e("stable", 2), e("crit", 9), e("warn", 6)])
        XCTAssertEqual(m.items.map(\.id), ["crit", "warn", "stable"])
    }
    func testFooterAndToggle() {
        let m = HandoverModel()
        m.assemble(from: [e("a", 2), e("b", 9), e("c", 6)])
        XCTAssertEqual(m.footer, "3 patients · 2 flagged")
        XCTAssertFalse(m.allHandedOff)
        for i in m.items { m.toggle(i.id) }
        XCTAssertTrue(m.allHandedOff)
    }
}
