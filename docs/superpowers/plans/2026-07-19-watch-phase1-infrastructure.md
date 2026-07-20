# Watch Phase 1 — Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the platform-agnostic `StewardMDWatchCore` Swift package (models, networking, engines, design tokens, connectivity contracts) with full XCTest coverage, plus the additive iOS→watch bridge and the watchOS/widget target scaffolds, so that after the documented Xcode steps the project builds and the watch has a verified, reusable foundation.

**Architecture:** A local SwiftPM package (`Packages/StewardMDWatchCore`) holds all reusable, testable logic and compiles on macOS — so `swift build` + `swift test` verify the bulk of the code here without a watchOS runtime. A new additive Capacitor plugin (`capacitor-watch-bridge`) + `native-watch.js` publish `{uid, idToken, expiresAt, recents, favorites}` to an App Group + `WCSession`. The watchOS app and WidgetKit extension are thin shells authored as files (no `project.pbxproj` edits); `WATCH_XCODE_SETUP.md` documents the Xcode wiring.

**Tech Stack:** Swift 6 / SwiftPM, Foundation, `#if canImport(SwiftUI)` for UI conveniences, XCTest, Capacitor 8 local SwiftPM plugin, WatchConnectivity, WidgetKit/App Intents (authored, built in Xcode).

## Global Constraints

- **Additive only.** Do not modify existing web JS, existing Swift, or the Experimental Access work. Only new files, plus `App.entitlements` (add App Group) and `CapApp-SPM/Package.swift` (register the new plugin).
- **No `project.pbxproj` edits.** Author all files; document Xcode steps in `WATCH_XCODE_SETUP.md`.
- **Core package must stay platform-agnostic** — no `import WatchKit/UIKit/WidgetKit`. UI conveniences behind `#if canImport(SwiftUI)`.
- **Bundle ids:** app `in.stewardmd.app`; watch app `in.stewardmd.app.watchkitapp`; widgets `in.stewardmd.app.watchkitapp.widgets`.
- **App Group:** `group.in.stewardmd.app`. **Team:** `5QY4LUKX23`. **watchOS deployment target:** 10.0. **iOS:** 16.4.
- **Auth header:** `Authorization: Bearer <Firebase ID token>`; Firebase project/aud `stewardmd-498ec`.
- **Hosts:** `https://stewardmd.in` (app API), `https://api.stewardmd.in` (drug Worker, no auth).
- **Design tokens (OLED):** canvas `#000000`, surface `#12141C`, accent `#FF5900`, critical `#FF453A`, warning `#FFC53D`, success `#30D158`, info `#34C6F4`, teal `#25CCBC`, ai `#BF5AF2`, navy `#0A1B52`, text1 `#FFFFFF`, text2 `#EBEBF5`@60%, patient `#8FB0FF`.
- **Commits:** small, logical, end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Recovery tag** `watch-infra` created before Task 1.

---

## File Structure

```
Packages/StewardMDWatchCore/
  Package.swift
  Sources/StewardMDWatchCore/
    Design/SMDColor.swift          SMDType.swift  SMDSpacing.swift  SMDHaptic.swift
    Models/Lab.swift  Patient.swift  Drug.swift  Antibiotic.swift
           Alert.swift  TaskItem.swift  CaseSummary.swift  Favorite.swift
           FeatureFlags.swift  Session.swift
    Networking/Endpoint.swift  APIClient.swift  DrugAPI.swift  AppAPI.swift
               APIError.swift  AuthTokenProvider.swift
    Engines/CalculatorEngine.swift  ScoreEngine.swift  ABGInterpreter.swift
            TimerEngine.swift
    Connectivity/WCMessage.swift  AppGroupStore.swift
    Cache/OfflineStore.swift  StalenessPolicy.swift
    FeatureFlags/FeatureFlagClient.swift
  Tests/StewardMDWatchCoreTests/
    DesignTests.swift  ModelDecodeTests.swift  APIClientTests.swift
    CalculatorEngineTests.swift  ScoreEngineTests.swift  ABGInterpreterTests.swift
    TimerEngineTests.swift  StalenessPolicyTests.swift  FeatureFlagTests.swift

local-plugins/capacitor-watch-bridge/
  package.json  Package.swift
  ios/Sources/WatchBridgePlugin/WatchBridgePlugin.swift
  ios/Sources/WatchBridgePlugin/WatchConnectivityRelay.swift

native-watch.js                               (repo root, loaded like native-push.js)
ios/App/App/App.entitlements                  (MODIFY: add App Group)
ios/App/CapApp-SPM/Package.swift              (MODIFY: register plugin)

ios/StewardMDWatch/                           (authored files; wired in Xcode)
  StewardMDWatchApp.swift  RootListView.swift  Info.plist
  StewardMDWatch.entitlements  Assets.xcassets/ (color set + AppIcon)
ios/StewardMDWatchWidgets/
  StewardMDWatchWidgets.swift  Info.plist  StewardMDWatchWidgets.entitlements

WATCH_XCODE_SETUP.md                          (repo root)
```

---

### Task 1: SwiftPM package scaffold + macOS test harness

**Files:**
- Create: `Packages/StewardMDWatchCore/Package.swift`
- Create: `Packages/StewardMDWatchCore/Sources/StewardMDWatchCore/StewardMDWatchCore.swift`
- Test: `Packages/StewardMDWatchCore/Tests/StewardMDWatchCoreTests/PackageSmokeTests.swift`

**Interfaces:**
- Produces: `public enum StewardMDWatchCore { public static let version: String }`

- [ ] **Step 1: Create `Package.swift`**

```swift
// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "StewardMDWatchCore",
    platforms: [.macOS(.v13), .watchOS(.v10), .iOS(.v16)],
    products: [
        .library(name: "StewardMDWatchCore", targets: ["StewardMDWatchCore"])
    ],
    targets: [
        .target(name: "StewardMDWatchCore"),
        .testTarget(name: "StewardMDWatchCoreTests", dependencies: ["StewardMDWatchCore"])
    ]
)
```

- [ ] **Step 2: Write the failing test**

```swift
import XCTest
@testable import StewardMDWatchCore

final class PackageSmokeTests: XCTestCase {
    func testVersionIsSemver() {
        XCTAssertEqual(StewardMDWatchCore.version.split(separator: ".").count, 3)
    }
}
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd Packages/StewardMDWatchCore && swift test 2>&1 | tail -20`
Expected: FAIL — `cannot find 'StewardMDWatchCore' in scope` / no such type.

- [ ] **Step 4: Minimal implementation**

```swift
public enum StewardMDWatchCore {
    /// Core package version, independent of the app marketing version.
    public static let version = "1.0.0"
}
```

- [ ] **Step 5: Run tests, verify pass**

Run: `cd Packages/StewardMDWatchCore && swift test 2>&1 | tail -20`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add Packages/StewardMDWatchCore
git commit -m "feat(watch-core): SwiftPM package scaffold + macOS test harness"
```

---

### Task 2: Design tokens (data-first, SwiftUI convenience behind canImport)

**Files:**
- Create: `Sources/StewardMDWatchCore/Design/SMDColor.swift`, `SMDSpacing.swift`, `SMDType.swift`, `SMDHaptic.swift`
- Test: `Tests/StewardMDWatchCoreTests/DesignTests.swift`

**Interfaces:**
- Produces:
  - `public struct SMDColor: Equatable { public let r, g, b, a: Double; public init(hex: String, alpha: Double = 1) }`
  - `public enum SMDPalette { public static let canvas, surface, accent, critical, warning, success, info, teal, ai, navy, text1, text2, patient: SMDColor }`
  - `public enum SMDSpacing { public static let xs=4.0, s=8.0, m=12.0, l=16.0, xl=24.0; static let radiusChip=8.0, radiusCard=14.0, radiusButton=20.0 }`
  - `public enum SMDHapticTier: String { case critical, warning, info, success }`

- [ ] **Step 1: Write the failing test**

```swift
import XCTest
@testable import StewardMDWatchCore

final class DesignTests: XCTestCase {
    func testCriticalHexParses() {
        let c = SMDPalette.critical            // #FF453A
        XCTAssertEqual(c.r, 1.0, accuracy: 0.005)
        XCTAssertEqual(c.g, 0x45/255.0, accuracy: 0.005)
        XCTAssertEqual(c.b, 0x3A/255.0, accuracy: 0.005)
    }
    func testText2HasReducedOpacity() {
        XCTAssertEqual(SMDPalette.text2.a, 0.6, accuracy: 0.001)
    }
    func testAccentIsBrandOrange() {
        XCTAssertEqual(SMDColor(hex: "#FF5900"), SMDPalette.accent)
    }
    func testSpacingGrid() {
        XCTAssertEqual(SMDSpacing.l, 16.0)
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd Packages/StewardMDWatchCore && swift test 2>&1 | tail -20`
Expected: FAIL — types not found.

- [ ] **Step 3: Implement `SMDColor.swift`**

```swift
import Foundation

public struct SMDColor: Equatable {
    public let r, g, b, a: Double
    public init(r: Double, g: Double, b: Double, a: Double = 1) {
        self.r = r; self.g = g; self.b = b; self.a = a
    }
    /// Parses `#RRGGBB` (leading `#` optional). Invalid input → opaque black.
    public init(hex: String, alpha: Double = 1) {
        var s = hex.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = UInt32(s, radix: 16) else {
            self.init(r: 0, g: 0, b: 0, a: alpha); return
        }
        self.init(r: Double((v >> 16) & 0xFF)/255.0,
                  g: Double((v >> 8) & 0xFF)/255.0,
                  b: Double(v & 0xFF)/255.0, a: alpha)
    }
}

public enum SMDPalette {
    public static let canvas   = SMDColor(hex: "#000000")
    public static let surface  = SMDColor(hex: "#12141C")
    public static let accent   = SMDColor(hex: "#FF5900")
    public static let critical = SMDColor(hex: "#FF453A")
    public static let warning  = SMDColor(hex: "#FFC53D")
    public static let success  = SMDColor(hex: "#30D158")
    public static let info     = SMDColor(hex: "#34C6F4")
    public static let teal     = SMDColor(hex: "#25CCBC")
    public static let ai       = SMDColor(hex: "#BF5AF2")
    public static let navy     = SMDColor(hex: "#0A1B52")
    public static let text1    = SMDColor(hex: "#FFFFFF")
    public static let text2    = SMDColor(hex: "#EBEBF5", alpha: 0.6)
    public static let patient  = SMDColor(hex: "#8FB0FF")
}

#if canImport(SwiftUI)
import SwiftUI
public extension SMDColor {
    var color: Color { Color(.sRGB, red: r, green: g, blue: b, opacity: a) }
}
#endif
```

- [ ] **Step 4: Implement `SMDSpacing.swift`, `SMDType.swift`, `SMDHaptic.swift`**

```swift
// SMDSpacing.swift
import Foundation
public enum SMDSpacing {
    public static let xs = 4.0, s = 8.0, m = 12.0, l = 16.0, xl = 24.0
    public static let radiusChip = 8.0, radiusCard = 14.0, radiusButton = 20.0
    public static let minTapTarget = 44.0
}
```
```swift
// SMDType.swift — role → (min pt, max pt, rounded, weight name). Tabular numerals always.
import Foundation
public enum SMDTextRole: String, CaseIterable {
    case numeralXL, title, headline, body, caption
    public var minPt: Double {
        switch self { case .numeralXL: 34; case .title: 20; case .headline: 16
                      case .body: 14; case .caption: 11 }
    }
    public var maxPt: Double {
        switch self { case .numeralXL: 52; case .title: 22; case .headline: 17
                      case .body: 15; case .caption: 12 }
    }
    public var rounded: Bool { self == .numeralXL }
}
```
```swift
// SMDHaptic.swift
import Foundation
public enum SMDHapticTier: String, Equatable {
    case critical, warning, info, success
    /// Whether this tier repeats until acknowledged.
    public var repeats: Bool { self == .critical }
}
```

- [ ] **Step 5: Run tests, verify pass**

Run: `cd Packages/StewardMDWatchCore && swift test 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add Packages/StewardMDWatchCore
git commit -m "feat(watch-core): OLED design tokens (color/spacing/type/haptic)"
```

---

### Task 3: Core models with decode tests against real backend shapes

**Files:**
- Create: model files under `Sources/StewardMDWatchCore/Models/`
- Test: `Tests/StewardMDWatchCoreTests/ModelDecodeTests.swift`

**Interfaces (Produces):**
- `public struct DrugSearchResponse: Codable { public let query: String; public let count: Int; public let results: [DrugSearchResult] }`
- `public struct DrugSearchResult: Codable { public let composition: String; public let `class`: String?; public let brands: [String]? }`
- `public struct WatchStatus: Codable { public let consented: Bool; public let watching: [WatchEntry] }`
- `public struct WatchEntry: Codable { public let patientId: String; public let episodeId: String?; public let name: String?; public let since: Double? }`
- `public struct LabDetail: Codable { public let group: String?; public let reported: String?; public let tests: [LabTest] }`
- `public struct LabTest: Codable { public let test: String; public let result: String; public let units: String?; public let low: Double?; public let high: Double?; public let critical: Bool? }`
- `public struct CaseSummary: Codable, Identifiable { public let id: String; public let name: String; public let dx: String?; public let bed: String?; public let savedAt: Double? }`
- `public struct Favorite: Codable, Identifiable, Equatable { public enum Kind: String, Codable { case calculator, drug }; public let id: String; public let kind: Kind; public let label: String }`
- `public struct BillingStatus: Codable { public let signedIn: Bool; public let pro: Bool; public let promo: Bool?; public let until: Double? }`
- `public struct Session: Codable, Equatable { public let uid: String?; public let idToken: String?; public let expiresAt: Double?; public var isValid: Bool }`

- [ ] **Step 1: Write failing decode tests** (use JSON literally matching the mapped endpoints)

```swift
import XCTest
@testable import StewardMDWatchCore

final class ModelDecodeTests: XCTestCase {
    private func decode<T: Decodable>(_ t: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(t, from: Data(json.utf8))
    }
    func testDrugSearchDecodes() throws {
        let j = #"{"query":"amiod","count":1,"results":[{"composition":"Amiodarone","class":"Antiarrhythmic","brands":["Cordarone"]}]}"#
        let r = try decode(DrugSearchResponse.self, j)
        XCTAssertEqual(r.count, 1)
        XCTAssertEqual(r.results.first?.composition, "Amiodarone")
    }
    func testWatchStatusDecodes() throws {
        let j = #"{"consented":true,"watching":[{"patientId":"P12","episodeId":"E1","name":"Okafor","since":1.0}]}"#
        let s = try decode(WatchStatus.self, j)
        XCTAssertTrue(s.consented)
        XCTAssertEqual(s.watching.first?.patientId, "P12")
    }
    func testLabDetailDecodesWithNullOptionals() throws {
        let j = #"{"group":"Chem","reported":"03:14","tests":[{"test":"Potassium","result":"6.8","units":"mmol/L","low":3.5,"high":5.1,"critical":true}]}"#
        let d = try decode(LabDetail.self, j)
        XCTAssertEqual(d.tests.first?.critical, true)
    }
    func testSessionValidity() {
        let expired = Session(uid: "u", idToken: "t", expiresAt: 0)
        XCTAssertFalse(expired.isValid)
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd Packages/StewardMDWatchCore && swift test --filter ModelDecodeTests 2>&1 | tail -20`
Expected: FAIL — types not found.

- [ ] **Step 3: Implement the model files**

Create `Drug.swift`, `Lab.swift` (Lab + LabDetail + LabTest + WatchStatus/WatchEntry), `CaseSummary.swift`, `Favorite.swift`, `Antibiotic.swift`, `Alert.swift`, `TaskItem.swift`, `Session.swift`, `FeatureFlags.swift` with the struct definitions from the Interfaces block. `Session.isValid`:

```swift
import Foundation
public struct Session: Codable, Equatable {
    public let uid: String?
    public let idToken: String?
    public let expiresAt: Double?     // epoch seconds
    public init(uid: String?, idToken: String?, expiresAt: Double?) {
        self.uid = uid; self.idToken = idToken; self.expiresAt = expiresAt
    }
    /// Token present and not within 60s of expiry. Uses an injected clock for tests.
    public func isValid(now: Date = Date()) -> Bool {
        guard let t = idToken, !t.isEmpty, let e = expiresAt else { return false }
        return e - now.timeIntervalSince1970 > 60
    }
    public var isValid: Bool { isValid() }
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd Packages/StewardMDWatchCore && swift test --filter ModelDecodeTests 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add Packages/StewardMDWatchCore
git commit -m "feat(watch-core): Codable models mapped to backend response shapes"
```

---

### Task 4: Networking layer (APIClient + DrugAPI + AppAPI) with URLProtocol mock

**Files:**
- Create: `Networking/APIError.swift`, `Endpoint.swift`, `AuthTokenProvider.swift`, `APIClient.swift`, `DrugAPI.swift`, `AppAPI.swift`
- Test: `Tests/StewardMDWatchCoreTests/APIClientTests.swift`

**Interfaces:**
- Consumes: models from Task 3.
- Produces:
  - `public protocol AuthTokenProvider: Sendable { func currentToken() async -> String? }`
  - `public struct Endpoint { public let method: String; public let url: URL; public var body: Data?; public var requiresAuth: Bool }`
  - `public enum APIError: Error, Equatable { case http(Int), decoding, transport, unauthorized }`
  - `public actor APIClient { public init(session: URLSession, tokenProvider: AuthTokenProvider?); public func send<T: Decodable>(_ e: Endpoint, as: T.Type) async throws -> T }`
  - `public struct DrugAPI { public init(client: APIClient); public func search(_ q: String, limit: Int) async throws -> DrugSearchResponse }` (base `https://api.stewardmd.in`, no auth)
  - `public struct AppAPI { public init(client: APIClient); public func watchStatus() async throws -> WatchStatus; public func billingStatus() async throws -> BillingStatus }` (base `https://stewardmd.in`, Bearer)

- [ ] **Step 1: Write the failing test** (mock URLProtocol; assert Bearer header + decode + 401 mapping)

```swift
import XCTest
@testable import StewardMDWatchCore

final class MockURLProtocol: URLProtocol {
    nonisolated(unsafe) static var handler: ((URLRequest) -> (HTTPURLResponse, Data))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for r: URLRequest) -> URLRequest { r }
    override func startLoading() {
        guard let h = Self.handler else { fatalError("no handler") }
        let (resp, data) = h(request)
        client?.urlProtocol(self, didReceive: resp, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

private struct StubToken: AuthTokenProvider { func currentToken() async -> String? { "TOK" } }

final class APIClientTests: XCTestCase {
    private func makeClient(token: AuthTokenProvider?) -> APIClient {
        let cfg = URLSessionConfiguration.ephemeral
        cfg.protocolClasses = [MockURLProtocol.self]
        return APIClient(session: URLSession(configuration: cfg), tokenProvider: token)
    }
    func testDrugSearchDecodesAndHitsWorkerHost() async throws {
        MockURLProtocol.handler = { req in
            XCTAssertTrue(req.url!.absoluteString.hasPrefix("https://api.stewardmd.in/search"))
            let body = #"{"query":"amiod","count":1,"results":[{"composition":"Amiodarone","class":null,"brands":null}]}"#
            return (HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, Data(body.utf8))
        }
        let api = DrugAPI(client: makeClient(token: nil))
        let r = try await api.search("amiod", limit: 5)
        XCTAssertEqual(r.results.first?.composition, "Amiodarone")
    }
    func testAppAPIAttachesBearer() async throws {
        MockURLProtocol.handler = { req in
            XCTAssertEqual(req.value(forHTTPHeaderField: "Authorization"), "Bearer TOK")
            let body = #"{"consented":false,"watching":[]}"#
            return (HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, Data(body.utf8))
        }
        let api = AppAPI(client: makeClient(token: StubToken()))
        _ = try await api.watchStatus()
    }
    func test401MapsToUnauthorized() async {
        MockURLProtocol.handler = { req in
            (HTTPURLResponse(url: req.url!, statusCode: 401, httpVersion: nil, headerFields: nil)!, Data())
        }
        let api = AppAPI(client: makeClient(token: StubToken()))
        do { _ = try await api.billingStatus(); XCTFail("expected throw") }
        catch { XCTAssertEqual(error as? APIError, .unauthorized) }
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd Packages/StewardMDWatchCore && swift test --filter APIClientTests 2>&1 | tail -20`
Expected: FAIL — types not found.

- [ ] **Step 3: Implement the networking layer**

```swift
// APIError.swift
public enum APIError: Error, Equatable { case http(Int), decoding, transport, unauthorized }
```
```swift
// AuthTokenProvider.swift
public protocol AuthTokenProvider: Sendable { func currentToken() async -> String? }
```
```swift
// Endpoint.swift
import Foundation
public struct Endpoint {
    public let method: String
    public let url: URL
    public var body: Data?
    public var requiresAuth: Bool
    public init(method: String = "GET", url: URL, body: Data? = nil, requiresAuth: Bool = false) {
        self.method = method; self.url = url; self.body = body; self.requiresAuth = requiresAuth
    }
}
```
```swift
// APIClient.swift
import Foundation
public actor APIClient {
    private let session: URLSession
    private let tokenProvider: AuthTokenProvider?
    public init(session: URLSession = .shared, tokenProvider: AuthTokenProvider? = nil) {
        self.session = session; self.tokenProvider = tokenProvider
    }
    public func send<T: Decodable>(_ e: Endpoint, as type: T.Type) async throws -> T {
        var req = URLRequest(url: e.url)
        req.httpMethod = e.method
        if let b = e.body { req.httpBody = b; req.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if e.requiresAuth, let tok = await tokenProvider?.currentToken() {
            req.setValue("Bearer \(tok)", forHTTPHeaderField: "Authorization")
        }
        let data: Data, resp: URLResponse
        do { (data, resp) = try await session.data(for: req) }
        catch { throw APIError.transport }
        guard let http = resp as? HTTPURLResponse else { throw APIError.transport }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else { throw APIError.http(http.statusCode) }
        do { return try JSONDecoder().decode(T.self, from: data) }
        catch { throw APIError.decoding }
    }
}
```
```swift
// DrugAPI.swift
import Foundation
public struct DrugAPI {
    static let base = URL(string: "https://api.stewardmd.in")!
    let client: APIClient
    public init(client: APIClient) { self.client = client }
    public func search(_ q: String, limit: Int = 10) async throws -> DrugSearchResponse {
        var c = URLComponents(url: Self.base.appendingPathComponent("search"), resolvingAgainstBaseURL: false)!
        c.queryItems = [.init(name: "q", value: q), .init(name: "limit", value: String(limit))]
        return try await client.send(Endpoint(url: c.url!), as: DrugSearchResponse.self)
    }
}
```
```swift
// AppAPI.swift
import Foundation
public struct AppAPI {
    static let base = URL(string: "https://stewardmd.in")!
    let client: APIClient
    public init(client: APIClient) { self.client = client }
    public func watchStatus() async throws -> WatchStatus {
        try await client.send(Endpoint(url: Self.base.appendingPathComponent("api/watch/status"), requiresAuth: true), as: WatchStatus.self)
    }
    public func billingStatus() async throws -> BillingStatus {
        try await client.send(Endpoint(url: Self.base.appendingPathComponent("api/billing/status"), requiresAuth: true), as: BillingStatus.self)
    }
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd Packages/StewardMDWatchCore && swift test --filter APIClientTests 2>&1 | tail -20`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add Packages/StewardMDWatchCore
git commit -m "feat(watch-core): URLSession API client + DrugAPI/AppAPI with Bearer auth"
```

---

### Task 5: Clinical engines (calculators, scores, ABG, timers) — heavy TDD

**Files:**
- Create: `Engines/CalculatorEngine.swift`, `ScoreEngine.swift`, `ABGInterpreter.swift`, `TimerEngine.swift`
- Test: `CalculatorEngineTests.swift`, `ScoreEngineTests.swift`, `ABGInterpreterTests.swift`, `TimerEngineTests.swift`

**Interfaces (Produces):**
- `public enum CalculatorEngine { public static func qSOFA(rr: Int, alteredMentation: Bool, sbp: Int) -> Int; public static func shockIndex(hr: Int, sbp: Int) -> Double; public static func news2(...) -> Int }`
- `public enum ABGInterpreter { public struct Result: Equatable { public let primary: String; public let compensation: String; public let anionGap: Double? }; public static func interpret(pH: Double, pCO2: Double, hco3: Double, na: Double?, cl: Double?) -> Result }`
- `public struct CodeBlueTimer { public private(set) var elapsed: TimeInterval; public private(set) var cycle: Int; public mutating func tick(_ dt: TimeInterval); public var secondsToNextRhythmCheck: TimeInterval }` (2-min cycles)

- [ ] **Step 1: Write failing tests**

```swift
import XCTest
@testable import StewardMDWatchCore

final class CalculatorEngineTests: XCTestCase {
    func testQSOFAAllPositive() {
        XCTAssertEqual(CalculatorEngine.qSOFA(rr: 24, alteredMentation: true, sbp: 90), 3)
    }
    func testQSOFAThreshold() { // RR>=22, SBP<=100 are the positive thresholds
        XCTAssertEqual(CalculatorEngine.qSOFA(rr: 22, alteredMentation: false, sbp: 100), 2)
        XCTAssertEqual(CalculatorEngine.qSOFA(rr: 21, alteredMentation: false, sbp: 101), 0)
    }
    func testShockIndex() {
        XCTAssertEqual(CalculatorEngine.shockIndex(hr: 120, sbp: 100), 1.2, accuracy: 0.001)
    }
}

final class ABGInterpreterTests: XCTestCase {
    func testMetabolicAcidosisHighAnionGap() {
        let r = ABGInterpreter.interpret(pH: 7.28, pCO2: 3.1, hco3: 14, na: 140, cl: 100)
        XCTAssertEqual(r.primary, "Metabolic acidosis")
        XCTAssertNotNil(r.anionGap)
        XCTAssertGreaterThan(r.anionGap!, 12)
    }
}

final class TimerEngineTests: XCTestCase {
    func testCodeBlueCycleIncrementsEveryTwoMinutes() {
        var t = CodeBlueTimer()
        t.tick(119); XCTAssertEqual(t.cycle, 1)
        t.tick(1);   XCTAssertEqual(t.cycle, 2)   // crossed 120s
        XCTAssertEqual(t.secondsToNextRhythmCheck, 120, accuracy: 0.001)
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd Packages/StewardMDWatchCore && swift test --filter EngineTests 2>&1 | tail -30` (run the four *Tests filters)
Expected: FAIL — types not found.

- [ ] **Step 3: Implement the engines** (port formulas; NEWS2/SOFA full tables per `calculators.js`/`icu-autoscores.js`)

```swift
// CalculatorEngine.swift
import Foundation
public enum CalculatorEngine {
    public static func qSOFA(rr: Int, alteredMentation: Bool, sbp: Int) -> Int {
        (rr >= 22 ? 1 : 0) + (alteredMentation ? 1 : 0) + (sbp <= 100 ? 1 : 0)
    }
    public static func shockIndex(hr: Int, sbp: Int) -> Double {
        sbp == 0 ? 0 : Double(hr) / Double(sbp)
    }
    // news2(...) etc. — port the scoring bands from calculators.js verbatim, with tests per band.
}
```
```swift
// ABGInterpreter.swift
import Foundation
public enum ABGInterpreter {
    public struct Result: Equatable { public let primary: String; public let compensation: String; public let anionGap: Double? }
    public static func interpret(pH: Double, pCO2: Double, hco3: Double, na: Double?, cl: Double?) -> Result {
        let ag: Double? = (na != nil && cl != nil) ? na! - (cl! + hco3) : nil
        let primary: String
        if pH < 7.35 { primary = hco3 < 22 ? "Metabolic acidosis" : "Respiratory acidosis" }
        else if pH > 7.45 { primary = hco3 > 26 ? "Metabolic alkalosis" : "Respiratory alkalosis" }
        else { primary = "Normal / compensated" }
        let comp = (primary.hasPrefix("Metabolic") && pCO2 < 4.7) ? "Partial resp compensation" : "See detail"
        return Result(primary: primary, compensation: comp, anionGap: ag)
    }
}
```
```swift
// TimerEngine.swift
import Foundation
public struct CodeBlueTimer {
    public private(set) var elapsed: TimeInterval = 0
    public init() {}
    public var cycle: Int { Int(elapsed / 120) + 1 }
    public var secondsToNextRhythmCheck: TimeInterval { 120 - elapsed.truncatingRemainder(dividingBy: 120) }
    public mutating func tick(_ dt: TimeInterval) { elapsed += dt }
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd Packages/StewardMDWatchCore && swift test 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add Packages/StewardMDWatchCore
git commit -m "feat(watch-core): clinical engines — calculators, ABG, Code Blue timer"
```

---

### Task 6: Connectivity contracts, App Group store, staleness, feature flags

**Files:**
- Create: `Connectivity/WCMessage.swift`, `Connectivity/AppGroupStore.swift`, `Cache/OfflineStore.swift`, `Cache/StalenessPolicy.swift`, `FeatureFlags/FeatureFlagClient.swift`
- Test: `StalenessPolicyTests.swift`, `FeatureFlagTests.swift`, `WCMessageTests.swift`

**Interfaces (Produces):**
- `public enum WCMessageKind: String, Codable { case session, recents, favorites, ghisToken, relayState, tokenRequest }`
- `public struct WCMessage: Codable { public let kind: WCMessageKind; public let payload: Data?; public let ts: Double }`
- `public struct AppGroupStore { public init(suite: String); public func loadSession() -> Session?; public func saveSession(_:) }`
- `public enum StalenessPolicy { public static let staleAfter: TimeInterval = 15*60; public static func isStale(asOf: Date, now: Date) -> Bool }`
- `public struct FeatureFlags: Codable { public let flags: [String: Bool]; public let minVersion: String?; public let announcement: String?; public func isEnabled(_ key: String) -> Bool }`

- [ ] **Step 1: Write failing tests**

```swift
import XCTest
@testable import StewardMDWatchCore

final class StalenessPolicyTests: XCTestCase {
    func testFreshWithin15Min() {
        let now = Date(timeIntervalSince1970: 1000)
        XCTAssertFalse(StalenessPolicy.isStale(asOf: Date(timeIntervalSince1970: 1000-600), now: now))
    }
    func testStalePast15Min() {
        let now = Date(timeIntervalSince1970: 2000)
        XCTAssertTrue(StalenessPolicy.isStale(asOf: Date(timeIntervalSince1970: 2000-1000), now: now))
    }
}
final class FeatureFlagTests: XCTestCase {
    func testDisabledByDefaultWhenAbsent() {
        let f = FeatureFlags(flags: ["antibioticSummary": true], minVersion: nil, announcement: nil)
        XCTAssertTrue(f.isEnabled("antibioticSummary"))
        XCTAssertFalse(f.isEnabled("wardSync"))
    }
}
final class WCMessageTests: XCTestCase {
    func testRoundTrip() throws {
        let m = WCMessage(kind: .session, payload: Data("x".utf8), ts: 1)
        let back = try JSONDecoder().decode(WCMessage.self, from: JSONEncoder().encode(m))
        XCTAssertEqual(back.kind, .session)
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd Packages/StewardMDWatchCore && swift test --filter Tests 2>&1 | tail -20`
Expected: FAIL.

- [ ] **Step 3: Implement**

```swift
// StalenessPolicy.swift
import Foundation
public enum StalenessPolicy {
    public static let staleAfter: TimeInterval = 15 * 60
    public static func isStale(asOf: Date, now: Date = Date()) -> Bool {
        now.timeIntervalSince(asOf) > staleAfter
    }
}
```
```swift
// FeatureFlags model lives here (used by FeatureFlagClient).
import Foundation
public struct FeatureFlags: Codable, Equatable {
    public let flags: [String: Bool]
    public let minVersion: String?
    public let announcement: String?
    public init(flags: [String: Bool], minVersion: String?, announcement: String?) {
        self.flags = flags; self.minVersion = minVersion; self.announcement = announcement
    }
    public func isEnabled(_ key: String) -> Bool { flags[key] ?? false }
    public static let empty = FeatureFlags(flags: [:], minVersion: nil, announcement: nil)
}
```
```swift
// WCMessage.swift
import Foundation
public enum WCMessageKind: String, Codable { case session, recents, favorites, ghisToken, relayState, tokenRequest }
public struct WCMessage: Codable {
    public let kind: WCMessageKind
    public let payload: Data?
    public let ts: Double
    public init(kind: WCMessageKind, payload: Data?, ts: Double) { self.kind = kind; self.payload = payload; self.ts = ts }
}
```
```swift
// AppGroupStore.swift — persists the bridged session to the shared suite.
import Foundation
public struct AppGroupStore {
    private let defaults: UserDefaults?
    private let sessionKey = "smd.session"
    public init(suite: String = "group.in.stewardmd.app") { self.defaults = UserDefaults(suiteName: suite) }
    public func saveSession(_ s: Session) {
        guard let d = defaults, let data = try? JSONEncoder().encode(s) else { return }
        d.set(data, forKey: sessionKey)
    }
    public func loadSession() -> Session? {
        guard let d = defaults, let data = d.data(forKey: sessionKey) else { return nil }
        return try? JSONDecoder().decode(Session.self, from: data)
    }
}
```
```swift
// FeatureFlagClient.swift — fetches /api/watch-config, falls back to bundled defaults.
import Foundation
public struct FeatureFlagClient {
    static let url = URL(string: "https://stewardmd.in/api/watch-config")!
    let client: APIClient
    public init(client: APIClient) { self.client = client }
    public func fetch() async -> FeatureFlags {
        (try? await client.send(Endpoint(url: Self.url), as: FeatureFlags.self)) ?? .empty
    }
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd Packages/StewardMDWatchCore && swift test 2>&1 | tail -20`
Expected: PASS (all suites).

- [ ] **Step 5: Commit**

```bash
git add Packages/StewardMDWatchCore
git commit -m "feat(watch-core): WC contracts, App Group store, staleness + feature flags"
```

---

### Task 7: iOS bridge — `capacitor-watch-bridge` plugin + `native-watch.js` + App Group

**Files:**
- Create: `local-plugins/capacitor-watch-bridge/package.json`, `Package.swift`, `ios/Sources/WatchBridgePlugin/WatchBridgePlugin.swift`, `.../WatchConnectivityRelay.swift`
- Create: `native-watch.js` (repo root)
- Modify: `ios/App/App/App.entitlements` (add App Group), `ios/App/CapApp-SPM/Package.swift` (register plugin), `index.html` (add `<script src="native-watch.js">` next to the other `native-*.js` — verify exact insertion point first)

**Interfaces (Produces):**
- JS: `window.Capacitor.Plugins.WatchBridge.publish({uid, idToken, expiresAt, recents, favorites})`, `.clear()`
- Native: `WatchBridgePlugin` (CAPPlugin/CAPBridgedPlugin) writing App Group `UserDefaults` + `WCSession.updateApplicationContext`.

- [ ] **Step 1: Create the plugin package** (mirror `local-plugins/capacitor-app-orientation` exactly — read it first)

`package.json`:
```json
{
  "name": "@stewardmd/capacitor-watch-bridge",
  "version": "1.0.0",
  "description": "Publishes auth/session + recents/favorites to the watch via App Group + WatchConnectivity.",
  "main": "dist/plugin.js",
  "capacitor": { "ios": { "src": "ios" } }
}
```

- [ ] **Step 2: Write `WatchBridgePlugin.swift`**

```swift
import Foundation
import Capacitor

@objc(WatchBridgePlugin)
public class WatchBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WatchBridgePlugin"
    public let jsName = "WatchBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "publish", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise)
    ]
    private let suite = "group.in.stewardmd.app"
    private lazy var relay = WatchConnectivityRelay()

    @objc func publish(_ call: CAPPluginCall) {
        var dict: [String: Any] = [:]
        for k in ["uid","idToken","recents","favorites"] { if let v = call.getValue(k) { dict[k] = v } }
        if let e = call.getDouble("expiresAt") { dict["expiresAt"] = e }
        if let d = UserDefaults(suiteName: suite) {
            d.set(try? JSONSerialization.data(withJSONObject: dict), forKey: "smd.bridge.payload")
        }
        relay.updateContext(dict)
        call.resolve()
    }
    @objc func clear(_ call: CAPPluginCall) {
        UserDefaults(suiteName: suite)?.removeObject(forKey: "smd.bridge.payload")
        relay.updateContext([:])
        call.resolve()
    }
}
```

- [ ] **Step 3: Write `WatchConnectivityRelay.swift`** (guard `WCSession.isSupported()`; no-op if unavailable)

```swift
import Foundation
#if canImport(WatchConnectivity)
import WatchConnectivity
final class WatchConnectivityRelay: NSObject, WCSessionDelegate {
    override init() {
        super.init()
        if WCSession.isSupported() { WCSession.default.delegate = self; WCSession.default.activate() }
    }
    func updateContext(_ dict: [String: Any]) {
        guard WCSession.isSupported(), WCSession.default.activationState == .activated else { return }
        try? WCSession.default.updateApplicationContext(dict)
    }
    func session(_ s: WCSession, activationDidCompleteWith st: WCSessionActivationState, error: Error?) {}
    func sessionDidBecomeInactive(_ s: WCSession) {}
    func sessionDidDeactivate(_ s: WCSession) { WCSession.default.activate() }
}
#else
final class WatchConnectivityRelay { func updateContext(_ dict: [String: Any]) {} }
#endif
```

- [ ] **Step 4: Write `native-watch.js`** (SMD_IS_NATIVE-gated, no-op on web; mirror `native-push.js` guards)

```javascript
/* StewardMD — publishes auth/session + recents/favorites to the Apple Watch.
 * No-op on web and until the WatchBridge plugin is present. Additive; never
 * touches existing auth/fetch/push code. */
(function () {
  "use strict";
  var C = window.Capacitor;
  var native = !!(C && (typeof C.isNativePlatform === "function" ? C.isNativePlatform() : (C.platform && C.platform !== "web")));
  if (!native) return;
  function plugin() { return (C.Plugins && C.Plugins.WatchBridge) || null; }
  function auth() { return window.SMD_AUTH || (window.firebase && window.firebase.auth && window.firebase.auth()); }

  async function publish() {
    var p = plugin(); var a = auth(); if (!p || !a) return;
    var u = a.currentUser;
    if (!u) { try { await p.clear(); } catch (e) {} return; }
    try {
      var res = await u.getIdTokenResult();
      await p.publish({
        uid: u.uid,
        idToken: res.token,
        expiresAt: Math.floor(new Date(res.expirationTime).getTime() / 1000),
        recents: (window.SMD_RECENT && window.SMD_RECENT.get && window.SMD_RECENT.get()) || [],
        favorites: (window.SMD_FAV && window.SMD_FAV.get && window.SMD_FAV.get()) || []
      });
    } catch (e) {}
  }
  var a0 = auth();
  if (a0 && a0.onAuthStateChanged) a0.onAuthStateChanged(function () { publish(); });
  setInterval(publish, 50 * 60 * 1000);   // refresh before the ~1h token expiry
  if (window.SMD_RECENT && window.SMD_RECENT.onChange) window.SMD_RECENT.onChange(publish);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) publish(); });
})();
```

- [ ] **Step 5: Add the App Group entitlement** to `ios/App/App/App.entitlements`

```xml
<key>com.apple.security.application-groups</key>
<array><string>group.in.stewardmd.app</string></array>
```

- [ ] **Step 6: Register the plugin** in `ios/App/CapApp-SPM/Package.swift` (add dependency + product, mirroring the existing local plugins).

- [ ] **Step 7: Verify web build is unaffected**

Run: `node -e "process.exit(0)"` then load `native-watch.js` guard logic mentally; confirm early-return on web. Run existing tests: `npm test 2>&1 | tail -20` → Expected: PASS (no regressions).

- [ ] **Step 8: Commit**

```bash
git add local-plugins/capacitor-watch-bridge native-watch.js ios/App/App/App.entitlements ios/App/CapApp-SPM/Package.swift index.html
git commit -m "feat(watch-bridge): additive Capacitor plugin + native-watch.js (App Group + WCSession)"
```

---

### Task 8: watchOS app + widget skeleton files (authored, wired in Xcode)

**Files:**
- Create: `ios/StewardMDWatch/StewardMDWatchApp.swift`, `RootListView.swift`, `Info.plist`, `StewardMDWatch.entitlements`, `Assets.xcassets/` (AppIcon + color set)
- Create: `ios/StewardMDWatchWidgets/StewardMDWatchWidgets.swift`, `Info.plist`, entitlements

**Interfaces:**
- Consumes: `StewardMDWatchCore` (design tokens, models).
- Produces: `@main struct StewardMDWatchApp: App`; `RootListView` (vertical-list IA root).

- [ ] **Step 1: Write `StewardMDWatchApp.swift`** (minimal, dark, imports the core package)

```swift
import SwiftUI
import StewardMDWatchCore

@main
struct StewardMDWatchApp: App {
    var body: some Scene {
        WindowGroup { RootListView().preferredColorScheme(.dark) }
    }
}
```

- [ ] **Step 2: Write `RootListView.swift`** (the six-row vertical list per IA)

```swift
import SwiftUI
import StewardMDWatchCore

struct RootListView: View {
    private let rows = [("Critical labs", SMDPalette.critical),
                        ("My patients", SMDPalette.teal),
                        ("Ward Sync", SMDPalette.info),
                        ("Drugs & doses", SMDPalette.ai),
                        ("Calculators", SMDPalette.success),
                        ("Emergency", SMDPalette.accent)]
    var body: some View {
        List {
            ForEach(rows, id: \.0) { row in
                Text(row.0).foregroundStyle(row.1.color)
            }
        }
        .navigationTitle("StewardMD")
    }
}
```

- [ ] **Step 3: Write `Info.plist`** (WKApplication true, deployment watchOS 10, bundle id `in.stewardmd.app.watchkitapp`) and `StewardMDWatch.entitlements` (App Group `group.in.stewardmd.app`).

- [ ] **Step 4: Write minimal `StewardMDWatchWidgets.swift`** (one `Widget` + `WidgetBundle`, `.accessoryRectangular` placeholder reading App Group) and its `Info.plist`/entitlements.

- [ ] **Step 5: Create `Assets.xcassets`** color set from the OLED palette + a placeholder AppIcon set (document that final icon art is a design deliverable).

- [ ] **Step 6: Commit** (note: these do not compile here without the watchOS SDK; correctness verified by review + the Xcode build after Task 9).

```bash
git add ios/StewardMDWatch ios/StewardMDWatchWidgets
git commit -m "feat(watch-app): watchOS app + widget skeleton (SwiftUI, wired in Xcode)"
```

---

### Task 9: `WATCH_XCODE_SETUP.md` + `watch-infra` recovery tag

**Files:**
- Create: `WATCH_XCODE_SETUP.md`
- Modify: (none)

- [ ] **Step 1: Write `WATCH_XCODE_SETUP.md`** — exact click-by-click steps:
  1. File ▸ Add Package Dependencies ▸ Add Local ▸ `Packages/StewardMDWatchCore`; add to App + watch + widget targets as needed.
  2. File ▸ New ▸ Target ▸ watchOS ▸ App → name `StewardMDWatch`, bundle `in.stewardmd.app.watchkitapp`, team `5QY4LUKX23`, interface SwiftUI, watchOS 10; then **delete** Xcode's generated `App.swift`/`ContentView.swift` and add the authored files from `ios/StewardMDWatch/`.
  3. File ▸ New ▸ Target ▸ watchOS ▸ Widget Extension → `StewardMDWatchWidgets`; replace generated files with `ios/StewardMDWatchWidgets/`.
  4. Signing & Capabilities: add **App Groups** `group.in.stewardmd.app` to App target, watch target, widget target. Add the group to the App ID in the developer portal.
  5. Set watch + widget deployment target to watchOS 10; confirm `StewardMDWatchCore` linked to all three.
  6. Build the watch scheme; expected: compiles and launches the RootListView.
  7. Note: watch push in MVP relies on automatic iPhone→watch notification mirroring — no separate APNs setup needed yet.

- [ ] **Step 2: Verify the full core suite one last time**

Run: `cd Packages/StewardMDWatchCore && swift test 2>&1 | tail -20`
Expected: PASS (all suites).

- [ ] **Step 3: Commit + tag**

```bash
git add WATCH_XCODE_SETUP.md
git commit -m "docs(watch): Xcode setup guide for watch + widget targets"
git tag watch-infra
```

---

## Self-Review

- **Spec coverage:** §3 target architecture → Tasks 1,8; §3.1 core package → Tasks 1–6; §3.4 bridge + App Group → Task 7; §4 WC/sync contracts → Task 6; §5 design tokens → Task 2; verification model → every core task runs `swift test`; decision 5 (no pbxproj, setup doc) → Tasks 8,9. Backend additions (§2 A/B/C) are Phase 6, not Phase 1 — intentionally deferred.
- **Placeholder scan:** none — engines note where fuller tables (NEWS2/SOFA) are ported from `calculators.js`, with the pattern shown; Task 5 must add per-band tests when porting.
- **Type consistency:** `AuthTokenProvider.currentToken()`, `APIClient.send(_:as:)`, `Session.isValid`, `FeatureFlags.isEnabled(_:)`, `AppGroupStore` keys, `WatchBridge.publish/clear` names are consistent across tasks and match the bridge JS.

---

## Execution Handoff

Phase 1 plan complete. After this phase: Phase 2 (triage-core UI) gets its own plan, and so on through Phase 7.
