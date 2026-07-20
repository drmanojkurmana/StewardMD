import Foundation

/// `GET /api/cases` — the doctor's saved ICU cases (Firebase-scoped KV).
public struct CasesResponse: Codable, Sendable {
    public let enabled: Bool
    public let cases: [CaseSummary]
}

public struct CaseSummary: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let name: String
    public let dx: String?
    public let bed: String?
    public let savedAt: Double?

    public init(id: String, name: String, dx: String?, bed: String?, savedAt: Double?) {
        self.id = id; self.name = name; self.dx = dx; self.bed = bed; self.savedAt = savedAt
    }
}
