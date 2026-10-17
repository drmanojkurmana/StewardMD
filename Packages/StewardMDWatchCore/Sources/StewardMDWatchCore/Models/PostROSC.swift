import Foundation

/// One post-ROSC checklist item. Pure text, no doses. British spelling.
public struct PostROSCItem: Identifiable, Equatable, Sendable {
    public let id: String
    public let text: String

    public init(id: String, text: String) {
        self.id = id; self.text = text
    }
}

/// Post-ROSC checklist per mode (spec). Adult and paediatric share one list;
/// neonatal has its own post-resuscitation list. Items may be ticked in order
/// or freely; the model logs each tick as a note event.
public enum PostROSCChecklist: Sendable {
    public static func items(mode: CodeMode) -> [PostROSCItem] {
        switch mode {
        case .adult, .paediatric:
            return [
                PostROSCItem(id: "airway-oxygen",
                             text: "Secure airway and titrate oxygen to SpO2 92 to 98 percent"),
                PostROSCItem(id: "ventilation",
                             text: "Ventilate to normal CO2"),
                PostROSCItem(id: "pressure",
                             text: "Avoid hypotension (systolic at least 90, MAP at least 65 in adults)"),
                PostROSCItem(id: "ecg",
                             text: "12-lead ECG"),
                PostROSCItem(id: "glucose",
                             text: "Blood glucose"),
                PostROSCItem(id: "temperature",
                             text: "Temperature control (avoid fever)"),
                PostROSCItem(id: "cause",
                             text: "Find and treat the cause (Hs and Ts)"),
                PostROSCItem(id: "neuro",
                             text: "Neuro assessment"),
                PostROSCItem(id: "icu",
                             text: "Transfer to ICU"),
            ]
        case .neonatal:
            return [
                PostROSCItem(id: "monitor",
                             text: "Monitor breathing, heart rate and oxygenation"),
                PostROSCItem(id: "glucose",
                             text: "Blood glucose"),
                PostROSCItem(id: "temperature",
                             text: "Keep warm and avoid fever"),
                PostROSCItem(id: "cooling",
                             text: "Consider therapeutic hypothermia criteria"),
                PostROSCItem(id: "parents",
                             text: "Support parental communication and contact"),
            ]
        }
    }
}

/// Fixed procedure vocabulary for code logging. Free text goes in a note.
public enum CodeProcedure: String, CaseIterable, Codable, Sendable {
    case ivAccess = "IV access"
    case ioAccess = "IO access"
    case advancedAirway = "Advanced airway"
    case etco2On = "ETCO2 on"
    case padsOn = "Pads on"
    case centralLine = "Central line"
    case arterialLine = "Arterial line"
}
