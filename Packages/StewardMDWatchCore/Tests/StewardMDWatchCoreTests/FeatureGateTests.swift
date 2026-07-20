import XCTest
@testable import StewardMDWatchCore

final class SemVerTests: XCTestCase {
    func testCompare() {
        XCTAssertEqual(SemVer.compare("1.0.0", "1.2.0"), -1)
        XCTAssertEqual(SemVer.compare("2.0.0", "1.9.9"), 1)
        XCTAssertEqual(SemVer.compare("1.2.3", "1.2.3"), 0)
        XCTAssertEqual(SemVer.compare("1.2", "1.2.0"), 0)     // missing patch == 0
    }
    func testRequiresUpdate() {
        let f = FeatureFlags(flags: [:], minVersion: "2.0.0", announcement: nil)
        XCTAssertTrue(f.requiresUpdate(currentVersion: "1.5.0"))
        XCTAssertFalse(f.requiresUpdate(currentVersion: "2.0.0"))
        XCTAssertFalse(f.requiresUpdate(currentVersion: "2.1.0"))
    }
    func testRequiresUpdateNoFloor() {
        let f = FeatureFlags(flags: [:], minVersion: nil, announcement: nil)
        XCTAssertFalse(f.requiresUpdate(currentVersion: "1.0.0"))
    }
}

final class FeatureGateTests: XCTestCase {
    private func flags(kill: Bool = false, minV: String? = "1.0.0", overrides: [String: Bool] = [:]) -> FeatureFlags {
        var f = FeatureFlags.shippedDefaults.flags
        overrides.forEach { f[$0.key] = $0.value }
        return FeatureFlags(flags: f, minVersion: minV, announcement: nil, killSwitch: kill)
    }

    func testKillSwitchDisablesEverything() {
        let g = FeatureGate(flags: flags(kill: true), isPro: true, appVersion: "2.0.0")
        XCTAssertEqual(g.evaluate(.criticalLabs), .disabledRemotely)
        XCTAssertEqual(g.evaluate(.codeBlue), .disabledRemotely)
    }

    func testFlagOffIsDisabledRemotely() {
        // antibioticSummary ships off
        let g = FeatureGate(flags: flags(), isPro: true, appVersion: "2.0.0")
        XCTAssertEqual(g.evaluate(.antibioticSummary), .disabledRemotely)
    }

    func testProFeatureWithoutProNeedsPro() {
        // wardSync ships on but requires Pro
        let g = FeatureGate(flags: flags(), isPro: false, appVersion: "2.0.0")
        XCTAssertEqual(g.evaluate(.wardSync), .needsPro)
    }

    func testBelowMinVersionNeedsUpdate() {
        let g = FeatureGate(flags: flags(minV: "3.0.0"), isPro: true, appVersion: "2.0.0")
        XCTAssertEqual(g.evaluate(.criticalLabs), .needsUpdate)
    }

    func testAllowed() {
        let g = FeatureGate(flags: flags(), isPro: true, appVersion: "2.0.0")
        XCTAssertEqual(g.evaluate(.criticalLabs), .allowed)
        XCTAssertTrue(g.allows(.codeBlue))
    }

    func testRemoteEnableOfExperimentalFeature() {
        // Server flips icuDeterioration on → allowed (no pouch needed if not pro-gated… it is pro)
        let g = FeatureGate(flags: flags(overrides: ["icuDeterioration": true]), isPro: true, appVersion: "2.0.0")
        XCTAssertEqual(g.evaluate(.icuDeterioration), .allowed)
    }
}
