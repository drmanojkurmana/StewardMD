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

    /// `GET /api/watch-config` — remote feature flags (public; token attached
    /// harmlessly). Falls back to shipped defaults handled by the caller.
    public func watchConfig() async throws -> FeatureFlags {
        try await get("api/watch-config", as: FeatureFlags.self)
    }

    /// `POST /api/watch/ack` — durable, idempotent acknowledge sync.
    public func acknowledge(_ ack: Ack) async throws {
        let body = try JSONEncoder().encode(ack)
        _ = try await client.send(
            Endpoint(method: "POST",
                     url: Self.base.appendingPathComponent("api/watch/ack"),
                     body: body, requiresAuth: true),
            as: OKResponse.self
        )
    }
}

/// Minimal `{ ok }` acknowledgement envelope.
struct OKResponse: Codable, Sendable { let ok: Bool? }
