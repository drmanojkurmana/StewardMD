import Foundation

/// A user favorite — a pinned calculator or drug. Stored watch-locally (offline
/// default) and synced with the backend-backed favorites feature via the bridge.
public struct Favorite: Codable, Sendable, Identifiable, Equatable {
    public enum Kind: String, Codable, Sendable { case calculator, drug }

    public let id: String       // stable key, e.g. "qsofa" or a composition name
    public let kind: Kind
    public let label: String

    public init(id: String, kind: Kind, label: String) {
        self.id = id; self.kind = kind; self.label = label
    }
}
