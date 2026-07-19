import Foundation

/// A wrist calculator the user can favorite and open (design §05). Input UI is
/// bespoke per calculator; scoring uses `CalculatorEngine`.
public struct CalculatorDef: Identifiable, Sendable, Equatable {
    public let id: String
    public let name: String
    public let subtitle: String

    public var asFavorite: Favorite { Favorite(id: id, kind: .calculator, label: name) }
}

/// The Crown-friendly calculators offered on the wrist.
public enum CalculatorCatalog {
    public static let all: [CalculatorDef] = [
        CalculatorDef(id: "qsofa", name: "qSOFA", subtitle: "Sepsis risk · 3 criteria"),
        CalculatorDef(id: "news2", name: "NEWS2", subtitle: "Early warning score"),
        CalculatorDef(id: "gcs", name: "GCS", subtitle: "Coma scale · E+V+M"),
        CalculatorDef(id: "shock", name: "Shock index", subtitle: "HR ÷ SBP")
    ]

    public static func def(_ id: String) -> CalculatorDef? {
        all.first { $0.id == id }
    }
}
