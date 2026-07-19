import Foundation

/// Drug/dose lookup against the public Worker (`https://api.stewardmd.in`, no auth).
/// This is the watch's most self-contained surface — usable offline-lite and
/// without a bridged token.
public struct DrugAPI: Sendable {
    static let base = URL(string: "https://api.stewardmd.in")!
    let client: APIClient

    public init(client: APIClient) { self.client = client }

    public func search(_ q: String, limit: Int = 10) async throws -> DrugSearchResponse {
        var c = URLComponents(url: Self.base.appendingPathComponent("search"), resolvingAgainstBaseURL: false)!
        c.queryItems = [
            URLQueryItem(name: "q", value: q),
            URLQueryItem(name: "limit", value: String(limit))
        ]
        return try await client.send(Endpoint(url: c.url!), as: DrugSearchResponse.self)
    }
}
