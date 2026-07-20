import XCTest
@testable import StewardMDWatchCore

final class PackageSmokeTests: XCTestCase {
    func testVersionIsSemver() {
        XCTAssertEqual(StewardMDWatchCore.version.split(separator: ".").count, 3)
    }
}
