import Foundation

/// A recorded acknowledgement of a critical result (design §10/§13). `id` is an
/// idempotency key so a duplicate ack (offline retry, double-tap) is a no-op
/// both locally and server-side.
public struct Ack: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let labId: String
    public let patientLabel: String?
    public let ackedAt: Double        // epoch seconds

    public init(id: String, labId: String, patientLabel: String?, ackedAt: Double) {
        self.id = id
        self.labId = labId
        self.patientLabel = patientLabel
        self.ackedAt = ackedAt
    }
}
