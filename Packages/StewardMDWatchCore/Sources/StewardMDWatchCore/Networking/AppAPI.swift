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

    /// `POST /api/watch/task` — set a shared task's status directly on the server
    /// (+ a "Task completed" timeline on done). The direct-API write-back path.
    public func setTaskStatus(gid: String, pid: String, taskId: String, status: String) async throws {
        struct Body: Encodable { let gid, pid, taskId, status: String }
        let body = try JSONEncoder().encode(Body(gid: gid, pid: pid, taskId: taskId, status: status))
        _ = try await client.send(
            Endpoint(method: "POST", url: Self.base.appendingPathComponent("api/watch/task"),
                     body: body, requiresAuth: true), as: OKResponse.self)
    }

    /// `POST /api/watch/timeline` — append a timeline event directly (critical-ack).
    public func appendTimeline(gid: String, pid: String, title: String,
                               type: String = "note", detail: String = "") async throws {
        struct Body: Encodable { let gid, pid, type, title, detail: String }
        let body = try JSONEncoder().encode(Body(gid: gid, pid: pid, type: type, title: title, detail: detail))
        _ = try await client.send(
            Endpoint(method: "POST", url: Self.base.appendingPathComponent("api/watch/timeline"),
                     body: body, requiresAuth: true), as: OKResponse.self)
    }

    /// `POST /api/watch/instruction` — post a round instruction dictated on the watch (e.g. after a
    /// critical-value ack the senior gives an order). The backend writes a pending task + audit event
    /// and fans the new-instruction push out to the whole unit.
    public func postInstruction(gid: String, pid: String, text: String, priority: String = "high") async throws {
        struct Body: Encodable { let gid, pid, text, priority: String }
        let body = try JSONEncoder().encode(Body(gid: gid, pid: pid, text: text, priority: priority))
        _ = try await client.send(
            Endpoint(method: "POST", url: Self.base.appendingPathComponent("api/watch/instruction"),
                     body: body, requiresAuth: true), as: OKResponse.self)
    }

    /// `POST /api/watch/codeblue` — a code started on the watch; the backend pushes a
    /// guaranteed alert to the clinician's own iPhone (fires even when the app is
    /// force-quit, which a local notification can't).
    public func codeBlueStart() async throws {
        struct Body: Encodable { let event: String }
        let body = try JSONEncoder().encode(Body(event: "start"))
        _ = try await client.send(
            Endpoint(method: "POST", url: Self.base.appendingPathComponent("api/watch/codeblue"),
                     body: body, requiresAuth: true), as: OKResponse.self)
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
