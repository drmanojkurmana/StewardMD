import Foundation
import Combine

/// ABG quick interpreter (design §06): Crown-dialed pH/CO₂/HCO₃ → acid-base
/// disorder + compensation + anion gap. Offline, no PHI. pCO₂ in kPa by default.
@MainActor
public final class ABGModel: ObservableObject {
    @Published public var pH = CrownField(value: 7.40, min: 6.80, max: 7.80, step: 0.01)
    @Published public var pCO2 = CrownField(value: 5.3, min: 1.0, max: 15.0, step: 0.1)   // kPa
    @Published public var hco3 = CrownField(value: 24, min: 1, max: 50, step: 1)
    @Published public var units: ABGInterpreter.PCO2Unit = .kPa

    public init() {}

    public var result: ABGInterpreter.Result {
        ABGInterpreter.interpret(pH: pH.value, pCO2: pCO2.value, hco3: hco3.value, units: units)
    }

    public var summaryLine: String {
        "\(result.primary.rawValue) · \(result.compensation.rawValue)"
    }
}
