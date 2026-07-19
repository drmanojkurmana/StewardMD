import XCTest
@testable import StewardMDWatchCore

final class CalculatorEngineTests: XCTestCase {

    // MARK: qSOFA (RR>=22, altered mentation, SBP<=100 each score 1)
    func testQSOFAAllPositive() {
        XCTAssertEqual(CalculatorEngine.qSOFA(rr: 24, alteredMentation: true, sbp: 90), 3)
    }
    func testQSOFAThresholds() {
        XCTAssertEqual(CalculatorEngine.qSOFA(rr: 22, alteredMentation: false, sbp: 100), 2)
        XCTAssertEqual(CalculatorEngine.qSOFA(rr: 21, alteredMentation: false, sbp: 101), 0)
    }
    func testQSOFAHighRiskFlag() {
        XCTAssertTrue(CalculatorEngine.qSOFAHighRisk(2))
        XCTAssertFalse(CalculatorEngine.qSOFAHighRisk(1))
    }

    // MARK: Shock index (HR / SBP)
    func testShockIndex() {
        XCTAssertEqual(CalculatorEngine.shockIndex(hr: 120, sbp: 100), 1.2, accuracy: 0.0001)
    }
    func testShockIndexGuardsZero() {
        XCTAssertEqual(CalculatorEngine.shockIndex(hr: 80, sbp: 0), 0)
    }

    // MARK: GCS (eye 1-4 + verbal 1-5 + motor 1-6)
    func testGCSFull() {
        XCTAssertEqual(CalculatorEngine.gcs(eye: 4, verbal: 5, motor: 6), 15)
    }
    func testGCSClampsInvalid() {
        XCTAssertEqual(CalculatorEngine.gcs(eye: 9, verbal: 0, motor: 6), 4 + 1 + 6)
    }

    // MARK: NEWS2 — canonical band boundaries
    func testNEWS2AllNormalIsZero() {
        let s = CalculatorEngine.news2(rr: 16, spo2: 98, onOxygen: false, sbp: 120, pulse: 70, alert: true, tempC: 37.0)
        XCTAssertEqual(s, 0)
    }
    func testNEWS2CriticalRespAndOxygen() {
        // RR 26 (3) + SpO2 91 (3) + on oxygen (2) = 8
        let s = CalculatorEngine.news2(rr: 26, spo2: 91, onOxygen: true, sbp: 120, pulse: 70, alert: true, tempC: 37.0)
        XCTAssertEqual(s, 8)
    }
    func testNEWS2LowBPAndBradyAndTemp() {
        // SBP 88 (3) + pulse 45 (1) + temp 35.0 (3) = 7
        let s = CalculatorEngine.news2(rr: 16, spo2: 98, onOxygen: false, sbp: 88, pulse: 45, alert: true, tempC: 35.0)
        XCTAssertEqual(s, 7)
    }
    func testNEWS2ConfusionScores3() {
        // altered consciousness (not alert) = 3
        let s = CalculatorEngine.news2(rr: 16, spo2: 98, onOxygen: false, sbp: 120, pulse: 70, alert: false, tempC: 37.0)
        XCTAssertEqual(s, 3)
    }
    func testNEWS2TachyAndFever() {
        // pulse 115 (2) + temp 38.5 (1) = 3
        let s = CalculatorEngine.news2(rr: 16, spo2: 98, onOxygen: false, sbp: 120, pulse: 115, alert: true, tempC: 38.5)
        XCTAssertEqual(s, 3)
    }
}
