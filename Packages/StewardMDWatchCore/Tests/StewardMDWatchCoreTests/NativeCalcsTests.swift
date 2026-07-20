import XCTest
@testable import StewardMDWatchCore

final class NativeCalcsTests: XCTestCase {
    private func run(_ id: String, _ v: [String: Any]) -> CalcOutput {
        NativeCalcCatalog.calc(id)!.compute(v)
    }

    func testMAP() {
        XCTAssertEqual(run("map", ["sbp": 120.0, "dbp": 80.0]).value, "93")   // (120+160)/3
        XCTAssertTrue(run("map", ["sbp": 90.0, "dbp": 50.0]).interp.contains("risk"))  // MAP 63 <65
    }
    func testAnionGap() {
        let o = run("aniongap", ["na": 140.0, "cl": 104.0, "hco3": 24.0])
        XCTAssertEqual(o.value, "12"); XCTAssertTrue(o.interp.contains("Normal"))
        XCTAssertTrue(run("aniongap", ["na": 140.0, "cl": 95.0, "hco3": 15.0]).interp.contains("High")) // 30
    }
    func testCorrectedCalcium() {
        XCTAssertEqual(run("corrca", ["ca": 8.0, "alb": 2.0]).value, "9.6")   // 8 + 0.8*2
    }
    func testCorrectedSodium() {
        XCTAssertEqual(run("corrna", ["na": 130.0, "glu": 300.0]).value, "133.2") // +1.6*2
    }
    func testCrCl() {
        XCTAssertEqual(run("crcl", ["age": 60.0, "wt": 72.0, "scr": 1.0, "female": false]).value, "80")
        XCTAssertEqual(run("crcl", ["age": 60.0, "wt": 72.0, "scr": 1.0, "female": true]).value, "68") // *0.85
    }
    func testBMI() {
        let o = run("bmi", ["wt": 70.0, "ht": 170.0])
        XCTAssertEqual(o.value, "24.2"); XCTAssertEqual(o.interp, "Normal")
        XCTAssertEqual(run("bmi", ["wt": 100.0, "ht": 170.0]).interp, "Obese")   // 34.6
    }
    func testBSA() {
        XCTAssertEqual(run("bsa", ["ht": 170.0, "wt": 70.0]).value, "1.82")
    }
    func testWinters() {
        XCTAssertEqual(run("winters", ["hco3": 24.0]).value, "42–46")   // 1.5*24+8=44 ±2
    }
    func testQTc() {
        XCTAssertEqual(run("qtc", ["qt": 400.0, "hr": 60.0]).value, "400")   // RR=1.0
        XCTAssertTrue(run("qtc", ["qt": 480.0, "hr": 75.0]).interp.contains("torsades")) // 537 ≥500
    }
    func testCURB65() {
        let o = run("curb65", ["conf": true, "urea": true, "bp": true, "rr": false, "age": false])
        XCTAssertEqual(o.value, "3"); XCTAssertTrue(o.interp.contains("Severe"))
    }
    func testMissingInputsGivesError() {
        XCTAssertNotNil(run("map", [:]).error)
    }

    func testWellsDVT() {
        let o = run("wellsdvt", ["cancer": true, "swell": true, "calf": true, "altdx": true]) // 3 - 2 = 1
        XCTAssertEqual(o.value, "1"); XCTAssertEqual(o.interp, "Moderate")
        XCTAssertTrue(run("wellsdvt", ["cancer": true, "swell": true, "calf": true]).interp.contains("High")) // 3
    }
    func testWellsPE() {
        let o = run("wellspe", ["dvt": true, "alt": true, "hr": true]) // 3+3+1.5 = 7.5
        XCTAssertEqual(o.value, "7.5"); XCTAssertTrue(o.interp.contains("High")); XCTAssertTrue(o.interp.contains("likely"))
    }
    func testCHADSVASc() {
        // age 80 (+2), female (+1), htn (+1), stroke (+2) = 6
        XCTAssertEqual(run("chadsvasc", ["age": 80.0, "female": true, "htn": true, "stroke": true]).value, "6")
        XCTAssertEqual(run("chadsvasc", ["age": 50.0]).value, "0")
    }
    func testHASBLED() {
        let o = run("hasbled", ["htn": true, "renal": true, "stroke": true]) // 3
        XCTAssertEqual(o.value, "3"); XCTAssertTrue(o.interp.contains("High"))
    }
    func testParkland() {
        let o = run("parkland", ["wt": 70.0, "tbsa": 30.0]) // 4*70*30 = 8400
        XCTAssertEqual(o.value, "8400"); XCTAssertTrue(o.interp.contains("4200"))
    }
    func testIBW() {
        // 175 cm ≈ 68.9 in → 50 + 2.3*8.9 ≈ 70.5 (male)
        XCTAssertEqual(run("ibw", ["ht": 175.0, "female": false]).value, "70.5")
    }
    func testMaintenanceFluids() {
        XCTAssertEqual(run("maint421", ["wt": 25.0]).value, "65") // 40 + 20 + 5
    }
    func testAaGradient() {
        // FiO2 21%, PaCO2 40, PaO2 90: PAO2 = 0.21*713 - 50 = 149.7-50 = 99.7; Aa ≈ 10
        XCTAssertEqual(run("aagrad", ["fio2": 21.0, "pao2": 90.0, "paco2": 40.0, "age": 40.0]).value, "10")
    }
}
