import XCTest
@testable import StewardMDWatchCore

#if canImport(JavaScriptCore)
@MainActor
final class CalcJSEngineTests: XCTestCase {

    // A compute in the exact calculators.js style (uses helpers, returns {v,u,i}).
    // Mirrors Burch-Wartofsky: sums scored `select` values, bands the interp.
    private let burchLike = "function(v){ var s=(+v.temp||0)+(+v.cns||0)+(+v.hr||0); var i=s>=45?'<b>≥45 — highly suggestive</b>':s>=25?'impending':'unlikely'; return { v:s, u:'points', i:i+'.' }; }"

    func testRunsSelectSummingCompute() {
        let e = CalcJSEngine()
        let out = e.run(burchLike, values: ["temp": "30", "cns": "20", "hr": "5"])
        XCTAssertNil(out.error)
        XCTAssertEqual(out.value, "55")
        XCTAssertEqual(out.unit, "points")
        XCTAssertEqual(out.interp, "≥45 — highly suggestive.")   // <b> stripped
    }

    func testNumberInputWithHelpers() {
        let e = CalcJSEngine()
        let src = "function(v){ if(!ok(v.x)) return ERR; return { v:r1(v.x*2), u:'mg', i:band(v.x,[[1,'low'],[100,'high']]) }; }"
        let out = e.run(src, values: ["x": 2.5])
        XCTAssertNil(out.error)
        XCTAssertEqual(out.value, "5")
        XCTAssertEqual(out.unit, "mg")
        XCTAssertEqual(out.interp, "high")
    }

    func testErrorWhenRequiredInputMissing() {
        let e = CalcJSEngine()
        let src = "function(v){ if(!ok(v.x)) return ERR; return { v:v.x, u:'', i:'' }; }"
        let out = e.run(src, values: [:])   // x absent → NaN → ERR
        XCTAssertEqual(out.error, "Enter all required values.")
    }

    func testCheckInputTruthy() {
        let e = CalcJSEngine()
        let src = "function(v){ var c = v.hd ? 3 : 1; return { v:c, u:'', i:'' }; }"
        XCTAssertEqual(e.run(src, values: ["hd": true]).value, "3")
        XCTAssertEqual(e.run(src, values: ["hd": false]).value, "1")
    }

    func testMalformedComputeYieldsError() {
        let e = CalcJSEngine()
        let out = e.run("function(v){ return v.nope.boom; }", values: [:])
        XCTAssertNotNil(out.error)
    }
}

#endif
