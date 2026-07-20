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
    public let brands: Int?          // brand-count for this composition (API returns a number)

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

/// `GET /structured?name=` — clinical quick-facts for the watch drug detail.
public struct DrugFactsResponse: Codable, Sendable {
    public let composition: String
    public let found: Bool
    public let data: DrugFacts?
    public init(composition: String, found: Bool, data: DrugFacts?) {
        self.composition = composition; self.found = found; self.data = data
    }
}

/// The glanceable subset of the structured monograph shown on the watch. Every
/// field is optional so a partial record still renders.
public struct DrugFacts: Codable, Sendable, Equatable {
    public let composition: String
    public let summary: String?
    public let therapeuticClass: String?
    public let adultDose: String?
    public let pedDose: String?
    public let renalAdjust: String?
    public let hepaticAdjust: String?
    public let administration: String?
    public let commonSe: String?

    enum CodingKeys: String, CodingKey {
        case composition, summary, administration
        case therapeuticClass = "therapeutic_class"
        case adultDose = "adult_dose"
        case pedDose = "ped_dose"
        case renalAdjust = "renal_adjust"
        case hepaticAdjust = "hepatic_adjust"
        case commonSe = "common_se"
    }

    public init(composition: String, summary: String?, therapeuticClass: String?,
                adultDose: String?, pedDose: String?, renalAdjust: String?,
                hepaticAdjust: String?, administration: String?, commonSe: String?) {
        self.composition = composition; self.summary = summary
        self.therapeuticClass = therapeuticClass; self.adultDose = adultDose
        self.pedDose = pedDose; self.renalAdjust = renalAdjust
        self.hepaticAdjust = hepaticAdjust; self.administration = administration
        self.commonSe = commonSe
    }
}
