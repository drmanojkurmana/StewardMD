import XCTest
@testable import StewardMDWatchCore

final class WatchTaskTests: XCTestCase {
    func testDecodesFromRelayPayload() throws {
        let j = #"{"id":"t1","groupId":"g1","patientId":"p1","patientLabel":"Bed 3 · Okafor","text":"Repeat ABG","priority":"high","status":"pending","assignedByName":"Dr Head","assignedToUid":"u2","dueAt":123.0,"ts":100.0}"#
        let t = try JSONDecoder().decode(WatchTask.self, from: Data(j.utf8))
        XCTAssertEqual(t.id, "t1")
        XCTAssertEqual(t.priority, "high")
        XCTAssertEqual(t.status, "pending")
        XCTAssertEqual(t.patientLabel, "Bed 3 · Okafor")
    }
}
