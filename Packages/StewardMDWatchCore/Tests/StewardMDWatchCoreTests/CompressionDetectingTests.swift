import XCTest
@testable import StewardMDWatchCore

@MainActor
final class CompressionDetectingTests: XCTestCase {
    func test_mockEmitsStatesToClosure() {
        let mock = MockCompressionDetector()
        var last: CompressionState?
        var ticks = 0
        mock.onChange = { st, tk in last = st; if tk.compressionCounted { ticks += 1 } }
        mock.start()
        mock.emit(count: 5, rate: 110, counted: true)
        mock.emit(count: 6, rate: 112, counted: true)
        XCTAssertEqual(last?.count, 6)
        XCTAssertEqual(last?.instantaneousRateCPM, 112)
        XCTAssertEqual(ticks, 2)
        mock.stop()
        XCTAssertFalse(mock.isRunning)
    }
}
