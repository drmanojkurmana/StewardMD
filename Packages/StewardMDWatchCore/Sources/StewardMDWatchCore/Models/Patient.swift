import Foundation

/// A watchlist row (design §05 "My patients") — sickest first, NEWS2-scored.
/// Assembled on the phone (GHIS/ICU) and relayed; the watch renders + ranks.
public struct WatchlistEntry: Codable, Sendable, Identifiable, Equatable, Hashable {
    public let id: String
    public let name: String
    public let bed: String?
    public let news2: Int?
    public let flag: String?          // short reason, e.g. "K+ rising"
    public let updatedAt: Double?
    /// Latest vitals for the patient-glance detail (relayed from the phone's ICU
    /// state). Nil when unknown (e.g. a GHIS-worklist-only patient).
    public let vitals: [Vital]?
    /// The shared unit this patient belongs to (name, e.g. "ICU" / "Gastro ward")
    /// and its kind ("icu" | "ward"), so the watch can tab by unit. Nil for the
    /// currently-open / local patient with no unit.
    public let unit: String?
    public let unitKind: String?

    public init(id: String, name: String, bed: String?, news2: Int?, flag: String?,
                updatedAt: Double?, vitals: [Vital]? = nil,
                unit: String? = nil, unitKind: String? = nil) {
        self.id = id; self.name = name; self.bed = bed
        self.news2 = news2; self.flag = flag; self.updatedAt = updatedAt
        self.vitals = vitals; self.unit = unit; self.unitKind = unitKind
    }

    /// NEWS2 → severity band (design colors): >=7 red, 5–6 amber, else green.
    public var severity: SMDHapticTier {
        switch news2 ?? 0 {
        case 7...: return .critical
        case 5...6: return .warning
        default: return .success
        }
    }
}

/// A single vital tile on the patient-glance screen.
public struct Vital: Codable, Sendable, Identifiable, Equatable, Hashable {
    public let id: String             // "HR", "BP", "SpO2", "Temp"
    public let value: String
    public let abnormal: Bool
    public init(id: String, value: String, abnormal: Bool) {
        self.id = id; self.value = value; self.abnormal = abnormal
    }
}

public struct PatientGlance: Codable, Sendable, Equatable {
    public let id: String
    public let name: String
    public let bed: String?
    public let demographics: String?  // "71M · #A4821"
    public let news2: Int?
    public let news2Previous: Int?
    public let vitals: [Vital]
    public let asOf: Double?

    public init(id: String, name: String, bed: String?, demographics: String?,
                news2: Int?, news2Previous: Int?, vitals: [Vital], asOf: Double?) {
        self.id = id; self.name = name; self.bed = bed; self.demographics = demographics
        self.news2 = news2; self.news2Previous = news2Previous; self.vitals = vitals; self.asOf = asOf
    }
}
