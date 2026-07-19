import Foundation

/// Response from `GET https://api.stewardmd.in/search` (public, no auth).
public struct DrugSearchResponse: Codable, Sendable {
    public let query: String
    public let count: Int
    public let results: [DrugSearchResult]
}

/// A composition-level search hit. `class` is a Swift keyword → mapped to `drugClass`.
public struct DrugSearchResult: Codable, Sendable, Identifiable, Equatable {
    public let composition: String
    public let drugClass: String?
    public let brands: [String]?

    public var id: String { composition }

    enum CodingKeys: String, CodingKey {
        case composition
        case drugClass = "class"
        case brands
    }
}

/// Distilled dosing facts surfaced on the watch (from `/composition` / `/structured`).
/// Kept small and glanceable — full monographs stay on the phone.
public struct DrugDose: Codable, Sendable, Equatable {
    public let composition: String
    public let route: String?
    public let dose: String?
    public let max: String?
    public let renal: String?

    public init(composition: String, route: String?, dose: String?, max: String?, renal: String?) {
        self.composition = composition; self.route = route
        self.dose = dose; self.max = max; self.renal = renal
    }
}
