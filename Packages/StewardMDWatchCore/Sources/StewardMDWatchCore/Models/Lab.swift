import Foundation

/// `GET /api/watch/status` — which patients the doctor is watching for new labs.
public struct WatchStatus: Codable, Sendable {
    public let consented: Bool
    public let watching: [WatchEntry]
}

public struct WatchEntry: Codable, Sendable, Identifiable, Equatable {
    public let patientId: String
    public let episodeId: String?
    public let name: String?
    public let since: Double?

    public var id: String { patientId }
}

/// `GET /api/ghis/lab-detail?renderId=&episodeId=` (relayed from phone — needs GHIS token).
public struct LabDetail: Codable, Sendable {
    public let group: String?
    public let department: String?
    public let sampleType: String?
    public let collected: String?
    public let reported: String?
    public let tests: [LabTest]
}

public struct LabTest: Codable, Sendable, Identifiable, Equatable {
    public let test: String
    public let result: String
    public let units: String?
    public let low: Double?
    public let high: Double?
    public let range: String?
    public let critical: Bool?
    public let method: String?

    public var id: String { test }

    /// Severity derived from the value against its reference range, for the
    /// gauge + severity chip. Falls back to the server's `critical` flag.
    public var severity: SMDHapticTier {
        if critical == true { return .critical }
        guard let v = Double(result.filter { "0123456789.-".contains($0) }) else { return .info }
        if let hi = high, v > hi { return .warning }
        if let lo = low, v < lo { return .warning }
        return .success
    }
}

/// A critical-lab alert as consumed from an APNs push payload (design §10).
public struct LabAlert: Codable, Sendable, Identifiable, Equatable, Hashable {
    public let id: String
    public let analyte: String       // e.g. "Potassium"
    public let value: String         // e.g. "6.8"
    public let units: String?
    public let refRange: String?
    public let patientLabel: String? // "Bed 12 · Okafor · 71M" (initials/bed only on AOD)
    public let severity: String      // "critical" | "warning"
    public let ts: Double?

    public init(id: String, analyte: String, value: String, units: String?, refRange: String?,
                patientLabel: String?, severity: String, ts: Double?) {
        self.id = id; self.analyte = analyte; self.value = value; self.units = units
        self.refRange = refRange; self.patientLabel = patientLabel; self.severity = severity; self.ts = ts
    }
}
