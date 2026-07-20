import XCTest
@testable import StewardMDWatchCore

@MainActor
final class DrugLookupModelTests: XCTestCase {
    private func model(_ handler: @escaping @Sendable (URLRequest) -> (HTTPURLResponse, Data)) -> DrugLookupModel {
        MockURLProtocol.handler = handler
        let cfg = URLSessionConfiguration.ephemeral
        cfg.protocolClasses = [MockURLProtocol.self]
        let client = APIClient(session: URLSession(configuration: cfg))
        return DrugLookupModel(api: DrugAPI(client: client))
    }
    override func tearDown() { MockURLProtocol.handler = nil; super.tearDown() }

    func testResultsState() async {
        let m = model { req in
            let body = #"{"query":"amiod","count":1,"results":[{"composition":"Amiodarone","class":"Antiarrhythmic","brands":3}]}"#
            return (HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, Data(body.utf8))
        }
        await m.search("amiod")
        guard case let .results(rows) = m.state else { return XCTFail("expected results, got \(m.state)") }
        XCTAssertEqual(rows.first?.composition, "Amiodarone")
    }

    func testEmptyState() async {
        let m = model { req in
            let body = #"{"query":"zzz","count":0,"results":[]}"#
            return (HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, Data(body.utf8))
        }
        await m.search("zzz")
        guard case .empty = m.state else { return XCTFail("expected empty, got \(m.state)") }
    }

    func testBlankQueryIsIdle() async {
        let m = model { req in
            (HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, Data("{}".utf8))
        }
        await m.search("   ")
        guard case .idle = m.state else { return XCTFail("expected idle, got \(m.state)") }
    }

    func testErrorState() async {
        let m = model { req in
            (HTTPURLResponse(url: req.url!, statusCode: 503, httpVersion: nil, headerFields: nil)!, Data())
        }
        await m.search("amiod")
        guard case .error = m.state else { return XCTFail("expected error, got \(m.state)") }
    }
}
