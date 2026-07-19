import XCTest
@testable import StewardMDWatchCore

final class StalenessPolicyTests: XCTestCase {
    func testFreshWithin15Min() {
        let now = Date(timeIntervalSince1970: 1000)
        XCTAssertFalse(StalenessPolicy.isStale(asOf: Date(timeIntervalSince1970: 1000 - 600), now: now))
    }
    func testStalePast15Min() {
        let now = Date(timeIntervalSince1970: 2000)
        XCTAssertTrue(StalenessPolicy.isStale(asOf: Date(timeIntervalSince1970: 2000 - 1000), now: now))
    }
    func testLabelFormatsAsOf() {
        // Deterministic: format a fixed instant in UTC.
        let s = StalenessPolicy.asOfLabel(Date(timeIntervalSince1970: 0), timeZone: TimeZone(identifier: "UTC")!)
        XCTAssertEqual(s, "as of 00:00")
    }
}

final class FeatureFlagTests: XCTestCase {
    func testDisabledByDefaultWhenAbsent() {
        let f = FeatureFlags(flags: ["antibioticSummary": true], minVersion: nil, announcement: nil, killSwitch: false)
        XCTAssertTrue(f.isEnabled("antibioticSummary"))
        XCTAssertFalse(f.isEnabled("wardSync"))
    }
    func testKillSwitchDisablesEverything() {
        let f = FeatureFlags(flags: ["wardSync": true], minVersion: nil, announcement: nil, killSwitch: true)
        XCTAssertFalse(f.isEnabled("wardSync"))
    }
    func testDecodesFromConfigJSON() throws {
        let j = #"{"flags":{"codeBlue":true},"minVersion":"1.0.0","announcement":"Beta","killSwitch":false}"#
        let f = try JSONDecoder().decode(FeatureFlags.self, from: Data(j.utf8))
        XCTAssertTrue(f.isEnabled("codeBlue"))
        XCTAssertEqual(f.announcement, "Beta")
    }
}

final class WCMessageTests: XCTestCase {
    func testRoundTrip() throws {
        let m = WCMessage(kind: .session, payload: Data("x".utf8), ts: 1)
        let back = try JSONDecoder().decode(WCMessage.self, from: JSONEncoder().encode(m))
        XCTAssertEqual(back.kind, .session)
        XCTAssertEqual(back.payload, Data("x".utf8))
    }
    func testTokenRequestKindExists() {
        XCTAssertEqual(WCMessageKind(rawValue: "tokenRequest"), .tokenRequest)
    }
}

final class AppGroupStoreTests: XCTestCase {
    func testSessionRoundTrips() {
        let suite = "test.smd.appgroup.\(UUID().uuidString)"
        let store = AppGroupStore(suite: suite)
        let s = Session(uid: "u1", idToken: "tok", expiresAt: 9_999_999)
        store.saveSession(s)
        XCTAssertEqual(store.loadSession(), s)
        UserDefaults(suiteName: suite)?.removePersistentDomain(forName: suite)
    }
    func testClearRemovesSession() {
        let suite = "test.smd.appgroup.\(UUID().uuidString)"
        let store = AppGroupStore(suite: suite)
        store.saveSession(Session(uid: "u", idToken: "t", expiresAt: 1))
        store.clear()
        XCTAssertNil(store.loadSession())
        UserDefaults(suiteName: suite)?.removePersistentDomain(forName: suite)
    }

    func testWatchlistRoundTrips() {
        let suite = "test.smd.appgroup.\(UUID().uuidString)"
        let store = AppGroupStore(suite: suite)
        XCTAssertTrue(store.loadWatchlist().isEmpty)   // absent → empty
        let list = [
            WatchlistEntry(id: "P12", name: "Okafor", bed: "12", news2: 9, flag: "K+ rising", updatedAt: 1),
            WatchlistEntry(id: "P7", name: "Dubois", bed: "7", news2: 6, flag: nil, updatedAt: 1)
        ]
        store.saveWatchlist(list)
        XCTAssertEqual(store.loadWatchlist().map(\.id), ["P12", "P7"])
        store.clear()
        XCTAssertTrue(store.loadWatchlist().isEmpty)
        UserDefaults(suiteName: suite)?.removePersistentDomain(forName: suite)
    }
}
