import XCTest
@testable import StewardMDWatchCore

/// Intercepts URLSession traffic so we can assert headers/hosts and return canned bodies.
final class MockURLProtocol: URLProtocol {
    nonisolated(unsafe) static var handler: (@Sendable (URLRequest) -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for r: URLRequest) -> URLRequest { r }
    override func startLoading() {
        guard let h = MockURLProtocol.handler else { fatalError("no handler set") }
        let (resp, data) = h(request)
        client?.urlProtocol(self, didReceive: resp, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

private struct StubToken: AuthTokenProvider {
    func currentToken() async -> String? { "TOK" }
}

final class APIClientTests: XCTestCase {
    private func makeClient(token: AuthTokenProvider?) -> APIClient {
        let cfg = URLSessionConfiguration.ephemeral
        cfg.protocolClasses = [MockURLProtocol.self]
        return APIClient(session: URLSession(configuration: cfg), tokenProvider: token)
    }

    override func tearDown() {
        MockURLProtocol.handler = nil
        super.tearDown()
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

    func testDrugSearchDoesNotAttachAuth() async throws {
        MockURLProtocol.handler = { req in
            XCTAssertNil(req.value(forHTTPHeaderField: "Authorization"))
            let body = #"{"query":"x","count":0,"results":[]}"#
            return (HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, Data(body.utf8))
        }
        _ = try await DrugAPI(client: makeClient(token: StubToken())).search("x")
    }

    func testAppAPIAttachesBearer() async throws {
        MockURLProtocol.handler = { req in
            XCTAssertEqual(req.value(forHTTPHeaderField: "Authorization"), "Bearer TOK")
            XCTAssertTrue(req.url!.absoluteString.hasPrefix("https://stewardmd.in/api/watch/status"))
            let body = #"{"consented":false,"watching":[]}"#
            return (HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, Data(body.utf8))
        }
        let api = AppAPI(client: makeClient(token: StubToken()))
        let s = try await api.watchStatus()
        XCTAssertFalse(s.consented)
    }

    func test401MapsToUnauthorized() async {
        MockURLProtocol.handler = { req in
            (HTTPURLResponse(url: req.url!, statusCode: 401, httpVersion: nil, headerFields: nil)!, Data())
        }
        let api = AppAPI(client: makeClient(token: StubToken()))
        do {
            _ = try await api.billingStatus()
            XCTFail("expected throw")
        } catch {
            XCTAssertEqual(error as? APIError, .unauthorized)
        }
    }

    func test500MapsToHTTP() async {
        MockURLProtocol.handler = { req in
            (HTTPURLResponse(url: req.url!, statusCode: 503, httpVersion: nil, headerFields: nil)!, Data())
        }
        do {
            _ = try await DrugAPI(client: makeClient(token: nil)).search("x")
            XCTFail("expected throw")
        } catch {
            XCTAssertEqual(error as? APIError, .http(503))
        }
    }
}
