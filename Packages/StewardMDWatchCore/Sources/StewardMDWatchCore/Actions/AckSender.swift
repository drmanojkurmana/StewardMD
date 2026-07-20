import Foundation

/// Persists the pending-ack list (design §12: actions queue locally, survive
/// relaunch). Synchronous so the `AckQueue` actor can load on init.
public protocol AckStore: Sendable {
    func load() -> [Ack]
    func save(_ acks: [Ack])
}

/// Sends one ack to the backend. Returns `true` on durable acceptance. The real
/// HTTP sender targets `POST /api/watch/ack` — an additive endpoint added in
/// Phase 6; until then a `LoggingAckSender` keeps the flow complete offline.
public protocol AckSender: Sendable {
    func send(_ ack: Ack) async -> Bool
}

/// App Group-backed ack persistence (shared with the widget for badge counts).
public struct UserDefaultsAckStore: AckStore {
    private let suite: String
    private let key = "smd.ackQueue"
    public init(suite: String = AppGroupStore.defaultSuite) { self.suite = suite }

    public func load() -> [Ack] {
        guard let d = UserDefaults(suiteName: suite), let data = d.data(forKey: key) else { return [] }
        return (try? JSONDecoder().decode([Ack].self, from: data)) ?? []
    }
    public func save(_ acks: [Ack]) {
        guard let d = UserDefaults(suiteName: suite), let data = try? JSONEncoder().encode(acks) else { return }
        d.set(data, forKey: key)
    }
}

/// Offline-safe default: reports success so the queue drains locally when no
/// network sender is wired (e.g. previews / tests).
public struct LoggingAckSender: AckSender {
    public init() {}
    public func send(_ ack: Ack) async -> Bool { true }
}

/// Production sender — POSTs to `/api/watch/ack` (idempotent server-side).
/// Returns false on any failure so the `AckQueue` retries later.
public struct HTTPAckSender: AckSender {
    let api: AppAPI
    public init(api: AppAPI) { self.api = api }
    public func send(_ ack: Ack) async -> Bool {
        do { try await api.acknowledge(ack); return true } catch { return false }
    }
}
