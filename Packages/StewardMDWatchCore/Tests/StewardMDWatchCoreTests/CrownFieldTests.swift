import XCTest
@testable import StewardMDWatchCore

final class CrownFieldTests: XCTestCase {
    func testClampsAtBounds() {
        var f = CrownField(value: 5, min: 0, max: 10, step: 1)
        f.set(99); XCTAssertEqual(f.value, 10)
        f.set(-5); XCTAssertEqual(f.value, 0)
    }
    func testIncrementDecrementStep() {
        var f = CrownField(value: 7.30, min: 6.8, max: 7.8, step: 0.01)
        f.increment(); XCTAssertEqual(f.value, 7.31, accuracy: 0.0001)
        f.decrement(); f.decrement(); XCTAssertEqual(f.value, 7.29, accuracy: 0.0001)
    }
    func testIncrementStopsAtMax() {
        var f = CrownField(value: 9.99, min: 0, max: 10, step: 0.5)
        f.increment(); XCTAssertEqual(f.value, 10)
    }
    func testNormalized() {
        let f = CrownField(value: 5, min: 0, max: 10, step: 1)
        XCTAssertEqual(f.normalized, 0.5, accuracy: 0.0001)
    }
}
