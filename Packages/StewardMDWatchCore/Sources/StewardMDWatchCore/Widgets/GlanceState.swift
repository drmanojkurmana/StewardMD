import Foundation

/// The shared snapshot that drives complications + Smart Stack widgets (design
/// §08/§09). Written by the app / iPhone bridge to the App Group; read by the
/// WidgetKit extension. Small and plist-friendly so widget reads are cheap.
public struct GlanceState: Codable, Equatable, Sendable {
    public var criticalCount: Int
    public var topCritical: String?
    public var patientCount: Int
    public var tasksDue: Int
    public var roundsDone: Int
    public var roundsTotal: Int
    public var censusOccupied: Int
    public var censusTotal: Int
    public var shiftEndsAt: Double?
    public var onCall: Bool
    public var ward: String?
    public var bleep: String?
    public var updatedAt: Double

    public init(criticalCount: Int = 0, topCritical: String? = nil, patientCount: Int = 0,
                tasksDue: Int = 0, roundsDone: Int = 0, roundsTotal: Int = 0,
                censusOccupied: Int = 0, censusTotal: Int = 0, shiftEndsAt: Double? = nil,
                onCall: Bool = false, ward: String? = nil, bleep: String? = nil, updatedAt: Double = 0) {
        self.criticalCount = criticalCount; self.topCritical = topCritical
        self.patientCount = patientCount; self.tasksDue = tasksDue
        self.roundsDone = roundsDone; self.roundsTotal = roundsTotal
        self.censusOccupied = censusOccupied; self.censusTotal = censusTotal
        self.shiftEndsAt = shiftEndsAt; self.onCall = onCall
        self.ward = ward; self.bleep = bleep; self.updatedAt = updatedAt
    }

    public static let empty = GlanceState()

    /// Convenience for updating a single field immutably.
    public func with(criticalCount: Int) -> GlanceState {
        var c = self; c.criticalCount = criticalCount; return c
    }

    /// Rounds completion 0…1 (guards divide-by-zero).
    public var roundsFraction: Double {
        roundsTotal > 0 ? Double(roundsDone) / Double(roundsTotal) : 0
    }
    /// Census occupancy 0…1.
    public var censusFraction: Double {
        censusTotal > 0 ? Double(censusOccupied) / Double(censusTotal) : 0
    }
}
