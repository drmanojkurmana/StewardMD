import XCTest
@testable import StewardMDWatchCore

final class NotificationPayloadTests: XCTestCase {
    private var criticalUserInfo: [AnyHashable: Any] {
        [
            "aps": ["alert": ["title": "CRITICAL LAB", "body": "Potassium 6.8"], "thread-id": "labs"],
            "url": "/?ghisPatient=P12",
            "id": "alert-1",
            "analyte": "Potassium",
            "value": "6.8",
            "units": "mmol/L",
            "refRange": "3.5–5.1",
            "patient": "Bed 12 · Okafor · 71M",
            "severity": "critical",
            "ts": 1_720_000_000.0
        ]
    }

    func testParsesLabAlert() {
        let a = NotificationParser.parse(criticalUserInfo)
        XCTAssertNotNil(a)
        XCTAssertEqual(a?.analyte, "Potassium")
        XCTAssertEqual(a?.value, "6.8")
        XCTAssertEqual(a?.severity, "critical")
        XCTAssertEqual(a?.patientLabel, "Bed 12 · Okafor · 71M")
    }

    func testReturnsNilWhenNoAnalyte() {
        XCTAssertNil(NotificationParser.parse(["aps": ["alert": "hello"]]))
    }

    func testShortLookHasNoPHI() {
        let a = NotificationParser.parse(criticalUserInfo)!
        let text = NotificationParser.shortLookText(a)
        XCTAssertEqual(text, "Critical result")
        XCTAssertFalse(text.contains("Okafor"))
        XCTAssertFalse(text.contains("6.8"))
    }

    func testShortLookWarning() {
        var ui = criticalUserInfo
        ui["severity"] = "warning"
        let a = NotificationParser.parse(ui)!
        XCTAssertEqual(NotificationParser.shortLookText(a), "Abnormal result")
    }

    func testHapticTierMapping() {
        let crit = NotificationParser.parse(criticalUserInfo)!
        XCTAssertEqual(NotificationParser.hapticTier(crit), .critical)
        var ui = criticalUserInfo; ui["severity"] = "warning"
        XCTAssertEqual(NotificationParser.hapticTier(NotificationParser.parse(ui)!), .warning)
    }

    func testDeepLinkPatientID() {
        XCTAssertEqual(NotificationParser.patientID(fromURL: "/?ghisPatient=P12"), "P12")
        XCTAssertNil(NotificationParser.patientID(fromURL: "/home"))
    }
}
