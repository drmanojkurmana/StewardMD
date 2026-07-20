import XCTest
@testable import StewardMDWatchCore

final class ModelDecodeTests: XCTestCase {
    private func decode<T: Decodable>(_ t: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(t, from: Data(json.utf8))
    }

    // MARK: Drug (api.stewardmd.in/search)
    func testDrugSearchDecodes() throws {
        // Real Worker shape: `brands` is a COUNT (e.g. 2679), not an array.
        let j = #"{"query":"amiod","count":1,"results":[{"composition":"Amiodarone","class":"Antiarrhythmic","brands":42}]}"#
        let r = try decode(DrugSearchResponse.self, j)
        XCTAssertEqual(r.count, 1)
        XCTAssertEqual(r.results.first?.composition, "Amiodarone")
        XCTAssertEqual(r.results.first?.drugClass, "Antiarrhythmic")
        XCTAssertEqual(r.results.first?.brands, 42)
    }

    func testDrugSearchDecodesWithNullClass() throws {
        let j = #"{"query":"x","count":1,"results":[{"composition":"Foo","class":null,"brands":null}]}"#
        let r = try decode(DrugSearchResponse.self, j)
        XCTAssertNil(r.results.first?.drugClass)
        XCTAssertNil(r.results.first?.brands)
    }

    func testDrugFactsDecodes() throws {
        let j = #"{"composition":"Pantoprazole","found":true,"data":{"composition":"Pantoprazole","summary":"PPI.","therapeutic_class":"PPI","adult_dose":"40 mg OD","ped_dose":"weight-based","renal_adjust":"None","hepatic_adjust":"Severe: 20 mg","administration":"Before breakfast","common_se":"Headache"}}"#
        let r = try decode(DrugFactsResponse.self, j)
        XCTAssertTrue(r.found)
        XCTAssertEqual(r.data?.adultDose, "40 mg OD")
        XCTAssertEqual(r.data?.renalAdjust, "None")
        XCTAssertEqual(r.data?.therapeuticClass, "PPI")
    }

    func testDrugFactsDecodesNotFound() throws {
        let j = #"{"composition":"Zzz","found":false,"data":null}"#
        let r = try decode(DrugFactsResponse.self, j)
        XCTAssertFalse(r.found)
        XCTAssertNil(r.data)
    }

    // MARK: Lab Watch (/api/watch/status)
    func testWatchStatusDecodes() throws {
        let j = #"{"consented":true,"watching":[{"patientId":"P12","episodeId":"E1","name":"Okafor","since":1.0}]}"#
        let s = try decode(WatchStatus.self, j)
        XCTAssertTrue(s.consented)
        XCTAssertEqual(s.watching.first?.patientId, "P12")
    }

    // MARK: Lab detail (/api/ghis/lab-detail)
    func testLabDetailDecodesWithCriticalFlag() throws {
        let j = #"{"group":"Chem","reported":"03:14","tests":[{"test":"Potassium","result":"6.8","units":"mmol/L","low":3.5,"high":5.1,"critical":true}]}"#
        let d = try decode(LabDetail.self, j)
        XCTAssertEqual(d.tests.first?.test, "Potassium")
        XCTAssertEqual(d.tests.first?.critical, true)
        XCTAssertEqual(d.tests.first?.high, 5.1)
    }

    // MARK: Saved cases (/api/cases)
    func testCasesListDecodes() throws {
        let j = #"{"enabled":true,"cases":[{"id":"c1","name":"Okafor","dx":"AKI","bed":"12","savedAt":1720000000.0}]}"#
        let r = try decode(CasesResponse.self, j)
        XCTAssertEqual(r.cases.first?.id, "c1")
        XCTAssertEqual(r.cases.first?.bed, "12")
    }

    // MARK: Billing (/api/billing/status)
    func testBillingStatusDecodes() throws {
        let j = #"{"signedIn":true,"pro":true,"promo":true,"until":null}"#
        let b = try decode(BillingStatus.self, j)
        XCTAssertTrue(b.pro)
        XCTAssertEqual(b.promo, true)
    }

    // MARK: Favorite round-trips
    func testFavoriteRoundTrips() throws {
        let f = Favorite(id: "qsofa", kind: .calculator, label: "qSOFA")
        let back = try decode(Favorite.self, String(data: JSONEncoder().encode(f), encoding: .utf8)!)
        XCTAssertEqual(back, f)
    }

    // MARK: Session validity
    func testSessionValidityExpired() {
        let expired = Session(uid: "u", idToken: "t", expiresAt: 0)
        XCTAssertFalse(expired.isValid(now: Date(timeIntervalSince1970: 100)))
    }

    func testSessionValidityFresh() {
        let fresh = Session(uid: "u", idToken: "t", expiresAt: 10_000)
        XCTAssertTrue(fresh.isValid(now: Date(timeIntervalSince1970: 100)))
    }

    func testSessionInvalidWhenNoToken() {
        let s = Session(uid: "u", idToken: nil, expiresAt: 10_000)
        XCTAssertFalse(s.isValid(now: Date(timeIntervalSince1970: 100)))
    }

    // MARK: Watchlist vitals (relayed) decode — present and absent
    func testWatchlistEntryDecodesVitals() throws {
        let j = #"{"id":"P12","name":"Okafor","bed":"12","news2":9,"flag":"septic shock","updatedAt":1.0,"vitals":[{"id":"HR","value":"112","abnormal":true},{"id":"SpO2","value":"91","abnormal":true}]}"#
        let e = try decode(WatchlistEntry.self, j)
        XCTAssertEqual(e.vitals?.count, 2)
        XCTAssertEqual(e.vitals?.first?.id, "HR")
        XCTAssertEqual(e.vitals?.first?.abnormal, true)
    }
    func testWatchlistEntryDecodesWithoutVitals() throws {
        let j = #"{"id":"P7","name":"Dubois","bed":"7","news2":6,"flag":null,"updatedAt":1.0}"#
        let e = try decode(WatchlistEntry.self, j)
        XCTAssertNil(e.vitals)
        XCTAssertNil(e.unit)   // back-compat: unit optional
    }

    // Relay payload with unit tags (drives the ICU/ward tabs).
    func testWatchlistEntryDecodesUnit() throws {
        let j = #"{"id":"P1","name":"Rao","bed":"3","news2":4,"flag":null,"updatedAt":1.0,"unit":"Gastro ward","unitKind":"ward"}"#
        let e = try decode(WatchlistEntry.self, j)
        XCTAssertEqual(e.unit, "Gastro ward")
        XCTAssertEqual(e.unitKind, "ward")
    }

    // MARK: Watchlist NEWS2 severity bands
    func testWatchlistSeverityBands() {
        func sev(_ n: Int) -> SMDHapticTier {
            WatchlistEntry(id: "x", name: "n", bed: nil, news2: n, flag: nil, updatedAt: nil).severity
        }
        XCTAssertEqual(sev(9), .critical)
        XCTAssertEqual(sev(7), .critical)
        XCTAssertEqual(sev(6), .warning)
        XCTAssertEqual(sev(5), .warning)
        XCTAssertEqual(sev(2), .success)
    }

    // MARK: Lab test severity from value vs range
    func testLabTestSeverityFromRange() {
        let hi = LabTest(test: "K", result: "6.8", units: "mmol/L", low: 3.5, high: 5.1,
                         range: nil, critical: false, method: nil)
        XCTAssertEqual(hi.severity, .warning)
        let crit = LabTest(test: "K", result: "6.8", units: "mmol/L", low: 3.5, high: 5.1,
                           range: nil, critical: true, method: nil)
        XCTAssertEqual(crit.severity, .critical)
    }

    // MARK: Task overdue
    func testTaskOverdue() {
        let t = TaskItem(id: "1", text: "Recheck K+", patientLabel: "Bed 12", dueAt: 100, done: false)
        XCTAssertTrue(t.isOverdue(now: Date(timeIntervalSince1970: 200)))
        XCTAssertFalse(t.isOverdue(now: Date(timeIntervalSince1970: 50)))
        var done = t; done.done = true
        XCTAssertFalse(done.isOverdue(now: Date(timeIntervalSince1970: 200)))
    }
}
