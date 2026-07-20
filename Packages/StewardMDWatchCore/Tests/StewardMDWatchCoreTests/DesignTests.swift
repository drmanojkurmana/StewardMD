import XCTest
@testable import StewardMDWatchCore

final class DesignTests: XCTestCase {
    func testCriticalHexParses() {
        let c = SMDPalette.critical            // #FF453A
        XCTAssertEqual(c.r, 1.0, accuracy: 0.005)
        XCTAssertEqual(c.g, Double(0x45) / 255.0, accuracy: 0.005)
        XCTAssertEqual(c.b, Double(0x3A) / 255.0, accuracy: 0.005)
    }

    func testText2HasReducedOpacity() {
        XCTAssertEqual(SMDPalette.text2.a, 0.6, accuracy: 0.001)
    }

    func testAccentIsBrandOrange() {
        XCTAssertEqual(SMDColor(hex: "#FF5900"), SMDPalette.accent)
    }

    func testHexAcceptsMissingHash() {
        XCTAssertEqual(SMDColor(hex: "FF5900"), SMDColor(hex: "#FF5900"))
    }

    func testInvalidHexFallsBackToBlack() {
        let c = SMDColor(hex: "zzz")
        XCTAssertEqual(c, SMDColor(r: 0, g: 0, b: 0, a: 1))
    }

    func testSpacingGrid() {
        XCTAssertEqual(SMDSpacing.l, 16.0)
        XCTAssertEqual(SMDSpacing.minTapTarget, 44.0)
    }

    func testTextRoleBounds() {
        XCTAssertEqual(SMDTextRole.numeralXL.minPt, 34)
        XCTAssertEqual(SMDTextRole.numeralXL.maxPt, 52)
        XCTAssertTrue(SMDTextRole.numeralXL.rounded)
        XCTAssertFalse(SMDTextRole.body.rounded)
    }

    func testCriticalHapticRepeats() {
        XCTAssertTrue(SMDHapticTier.critical.repeats)
        XCTAssertFalse(SMDHapticTier.success.repeats)
    }
}
