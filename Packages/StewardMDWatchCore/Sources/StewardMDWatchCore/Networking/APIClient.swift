import Foundation

/// Thin URLSession wrapper. An actor so token attachment + requests are
/// serialized safely. Maps transport/status/decoding failures to `APIError`.
public actor APIClient {
    private let session: URLSession
    private let tokenProvider: AuthTokenProvider?
    private let decoder = JSONDecoder()

    public init(session: URLSession = .shared, tokenProvider: AuthTokenProvider? = nil) {
        self.session = session
        self.tokenProvider = tokenProvider
    }

    public func send<T: Decodable & Sendable>(_ e: Endpoint, as type: T.Type) async throws -> T {
        var req = URLRequest(url: e.url)
        req.httpMethod = e.method
        if let b = e.body {
            req.httpBody = b
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if e.requiresAuth, let tok = await tokenProvider?.currentToken() {
            req.setValue("Bearer \(tok)", forHTTPHeaderField: "Authorization")
        }

        let data: Data
        let resp: URLResponse
        do {
            (data, resp) = try await session.data(for: req)
        } catch {
            throw APIError.transport
        }

        guard let http = resp as? HTTPURLResponse else { throw APIError.transport }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else { throw APIError.http(http.statusCode) }

        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decoding
        }
    }
}
