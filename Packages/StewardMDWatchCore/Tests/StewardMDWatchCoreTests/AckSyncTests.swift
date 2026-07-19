import XCTest
@testable import StewardMDWatchCore

final class AckSyncTests: XCTestCase {
    private func api(_ handler: @escaping @Sendable (URLRequest) -> (HTTPURLResponse, Data)) -> AppAPI {
        MockURLProtocol.handler = handler
        let cfg = URLSessionConfiguration.ephemeral
        cfg.protocolClasses = [MockURLProtocol.self]
        return AppAPI(client: APIClient(session: URLSession(configuration: cfg), tokenProvider: TokenStub()))
    }
    override func tearDown() { MockURLProtocol.handler = nil; super.tearDown() }

    func testHTTPAckSenderSucceedsOn200() async {
        let sender = HTTPAckSender(api: api { req in
            XCTAssertTrue(req.url!.absoluteString.hasSuffix("/api/watch/ack"))
            XCTAssertEqual(req.httpMethod, "POST")
            XCTAssertEqual(req.value(forHTTPHeaderField: "Authorization"), "Bearer TOK")
            return (HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, Data(#"{"ok":true}"#.utf8))
        })
        let ok = await sender.send(Ack(id: "a", labId: "L", patientLabel: "Bed 12", ackedAt: 1))
        XCTAssertTrue(ok)
    }

    func testHTTPAckSenderFailsOn500() async {
        let sender = HTTPAckSender(api: api { req in
            (HTTPURLResponse(url: req.url!, statusCode: 500, httpVersion: nil, headerFields: nil)!, Data())
        })
        let ok = await sender.send(Ack(id: "a", labId: "L", patientLabel: nil, ackedAt: 1))
        XCTAssertFalse(ok)
    }
}

private struct TokenStub: AuthTokenProvider {
    func currentToken() async -> String? { "TOK" }
}
