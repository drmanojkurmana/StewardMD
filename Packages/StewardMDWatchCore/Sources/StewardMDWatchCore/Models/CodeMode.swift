import Foundation

/// Resuscitation mode for a code (spec: CodeMode adult | paediatric | neonatal).
/// British spelling throughout ("paediatric").
public enum CodeMode: String, Codable, Sendable, CaseIterable {
    case adult
    case paediatric
    case neonatal

    /// Display name for pickers and the code sheet.
    public var displayName: String {
        switch self {
        case .adult: return "Adult"
        case .paediatric: return "Paediatric"
        case .neonatal: return "Neonatal"
        }
    }

    /// Rhythm (or heart-rate) check interval: adult 120 s, paediatric 120 s,
    /// neonatal 60 s (heart-rate check).
    public var rhythmCheckInterval: TimeInterval {
        switch self {
        case .adult, .paediatric: return 120
        case .neonatal: return 60
        }
    }

    /// Compression to ventilation labels per mode.
    public var compressionVentilationLabel: String {
        switch self {
        case .adult: return "30:2 (100 to 120 per min)"
        case .paediatric: return "15:2 with two rescuers, 30:2 alone"
        case .neonatal: return "3:1 (90 compressions and 30 breaths per min)"
        }
    }

    /// Continuous compressions with an advanced airway (adult/paediatric only):
    /// continuous compressions, 1 breath every 6 s. Nil for neonatal.
    public var advancedAirwayLabel: String? {
        switch self {
        case .adult, .paediatric: return "Continuous compressions, 1 breath every 6 s"
        case .neonatal: return nil
        }
    }

    /// Full per-mode config bundle.
    public var config: CodeConfig { CodeConfig(mode: self) }
}

/// Per-mode config: rhythm-check interval plus compression labels. Pure data.
public struct CodeConfig: Equatable, Sendable {
    public let mode: CodeMode
    public let rhythmCheckInterval: TimeInterval
    public let compressionVentilationLabel: String
    public let advancedAirwayLabel: String?

    public init(mode: CodeMode) {
        self.mode = mode
        self.rhythmCheckInterval = mode.rhythmCheckInterval
        self.compressionVentilationLabel = mode.compressionVentilationLabel
        self.advancedAirwayLabel = mode.advancedAirwayLabel
    }
}
