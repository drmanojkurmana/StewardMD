import Foundation

/// Arterial blood-gas quick interpreter (design §06). Crown-dialed pH/CO₂/HCO₃
/// → primary disorder, compensation, and anion gap. Offline, no PHI.
/// Screening support only — not a substitute for full clinical assessment.
public enum ABGInterpreter {

    public enum PCO2Unit: Sendable { case kPa, mmHg }

    public enum Disorder: String, Equatable, Sendable {
        case normal = "Normal / compensated"
        case metabolicAcidosis = "Metabolic acidosis"
        case respiratoryAcidosis = "Respiratory acidosis"
        case metabolicAlkalosis = "Metabolic alkalosis"
        case respiratoryAlkalosis = "Respiratory alkalosis"
    }

    public enum Compensation: String, Equatable, Sendable {
        case none = "Uncompensated"
        case partial = "Partial compensation"
        case full = "Fully compensated"
    }

    public struct Result: Equatable, Sendable {
        public let primary: Disorder
        public let compensation: Compensation
        public let anionGap: Double?
        public var raisedAnionGap: Bool { (anionGap ?? 0) > 12 }
    }

    /// pCO₂ normal bounds by unit: kPa 4.7–6.0, mmHg 35–45.
    private static func bounds(_ u: PCO2Unit) -> (low: Double, high: Double) {
        switch u { case .kPa: return (4.7, 6.0); case .mmHg: return (35, 45) }
    }

    public static func interpret(pH: Double, pCO2: Double, hco3: Double,
                                 units: PCO2Unit = .kPa,
                                 na: Double? = nil, cl: Double? = nil) -> Result {
        let (lo, hi) = bounds(units)
        let ag: Double? = (na != nil && cl != nil) ? na! - (cl! + hco3) : nil

        // Primary disorder
        let primary: Disorder
        var compensation: Compensation = .none

        if pH < 7.35 {                                  // acidaemia
            if hco3 < 22 { primary = .metabolicAcidosis }
            else if pCO2 > hi { primary = .respiratoryAcidosis }
            else { primary = .metabolicAcidosis }
            if primary == .metabolicAcidosis, pCO2 < lo { compensation = .partial }
            if primary == .respiratoryAcidosis, hco3 > 26 { compensation = .partial }
        } else if pH > 7.45 {                           // alkalaemia
            if hco3 > 26 { primary = .metabolicAlkalosis }
            else if pCO2 < lo { primary = .respiratoryAlkalosis }
            else { primary = .metabolicAlkalosis }
            if primary == .metabolicAlkalosis, pCO2 > hi { compensation = .partial }
            if primary == .respiratoryAlkalosis, hco3 < 22 { compensation = .partial }
        } else {                                        // normal pH
            let deranged = hco3 < 22 || hco3 > 26 || pCO2 < lo || pCO2 > hi
            primary = .normal
            compensation = deranged ? .full : .none
        }

        return Result(primary: primary, compensation: compensation, anionGap: ag)
    }
}
