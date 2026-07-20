import XCTest
@testable import StewardMDWatchCore

final class TimeFormatTests: XCTestCase {
    func testMMSS() {
        XCTAssertEqual(TimeFormat.mmss(0), "0:00")
        XCTAssertEqual(TimeFormat.mmss(84), "1:24")
        XCTAssertEqual(TimeFormat.mmss(3599), "59:59")
    }
    func testMMSSClampsNegative() {
        XCTAssertEqual(TimeFormat.mmss(-5), "0:00")
    }
    func testHMMSS() {
        XCTAssertEqual(TimeFormat.hmmss(3661), "1:01:01")
        XCTAssertEqual(TimeFormat.hmmss(59), "0:00:59")
    }
}
