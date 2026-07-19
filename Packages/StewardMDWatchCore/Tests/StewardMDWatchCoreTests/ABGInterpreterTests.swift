import XCTest
@testable import StewardMDWatchCore

final class ABGInterpreterTests: XCTestCase {

    // Brief's worked example: pH 7.28, CO2 3.1 kPa, HCO3 14 → metabolic acidosis,
    // partial resp compensation, raised anion gap (Na-(Cl+HCO3) = 140-114 = 26).
    func testMetabolicAcidosisHighAnionGap() {
        let r = ABGInterpreter.interpret(pH: 7.28, pCO2: 3.1, hco3: 14, units: .kPa, na: 140, cl: 100)
        XCTAssertEqual(r.primary, .metabolicAcidosis)
        XCTAssertEqual(r.compensation, .partial)
        XCTAssertNotNil(r.anionGap)
        XCTAssertEqual(r.anionGap!, 26, accuracy: 0.01)
        XCTAssertTrue(r.raisedAnionGap)
    }

    func testRespiratoryAcidosis() {
        // low pH, high CO2, normal-ish HCO3
        let r = ABGInterpreter.interpret(pH: 7.30, pCO2: 8.0, hco3: 24, units: .kPa, na: nil, cl: nil)
        XCTAssertEqual(r.primary, .respiratoryAcidosis)
        XCTAssertNil(r.anionGap)
    }

    func testMetabolicAlkalosis() {
        let r = ABGInterpreter.interpret(pH: 7.52, pCO2: 5.5, hco3: 34, units: .kPa, na: nil, cl: nil)
        XCTAssertEqual(r.primary, .metabolicAlkalosis)
    }

    func testRespiratoryAlkalosis() {
        let r = ABGInterpreter.interpret(pH: 7.50, pCO2: 3.5, hco3: 24, units: .kPa, na: nil, cl: nil)
        XCTAssertEqual(r.primary, .respiratoryAlkalosis)
    }

    func testNormal() {
        let r = ABGInterpreter.interpret(pH: 7.40, pCO2: 5.3, hco3: 24, units: .kPa, na: nil, cl: nil)
        XCTAssertEqual(r.primary, .normal)
    }

    func testMmHgUnitsRespiratoryAcidosis() {
        // 60 mmHg is high (normal 35-45) → respiratory acidosis
        let r = ABGInterpreter.interpret(pH: 7.30, pCO2: 60, hco3: 24, units: .mmHg, na: nil, cl: nil)
        XCTAssertEqual(r.primary, .respiratoryAcidosis)
    }
}
