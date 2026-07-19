import Foundation

/// Authenticated app API against Pages Functions (`https://stewardmd.in/api/*`).
/// Every call attaches the bridged Firebase Bearer token.
public struct AppAPI: Sendable {
    static let base = URL(string: "https://stewardmd.in")!
    let client: APIClient

    public init(client: APIClient) { self.client = client }

    private func get<T: Decodable & Sendable>(_ path: String, as type: T.Type) async throws -> T {
        try await client.send(
            Endpoint(url: Self.base.appendingPathComponent(path), requiresAuth: true),
            as: type
        )
    }

    /// `GET /api/watch/status` — the doctor's Lab-Watch list.
    public func watchStatus() async throws -> WatchStatus {
        try await get("api/watch/status", as: WatchStatus.self)
    }

    /// `GET /api/billing/status` — entitlement/subscription state.
    public func billingStatus() async throws -> BillingStatus {
        try await get("api/billing/status", as: BillingStatus.self)
    }

    /// `GET /api/cases` — saved ICU cases.
    public func cases() async throws -> CasesResponse {
        try await get("api/cases", as: CasesResponse.self)
    }
}
