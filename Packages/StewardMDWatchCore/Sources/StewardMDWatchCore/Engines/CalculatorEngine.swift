import Foundation

/// Bedside clinical scores, ported from `calculators.js` / `icu-autoscores.js`.
/// Pure functions — no network, no PHI — safe to run offline on the wrist.
///
/// NOTE: These are decision-support screening tools, not a substitute for
/// clinical judgement; the UI pairs each result with the app's safety framing.
public enum CalculatorEngine {

    // MARK: qSOFA
    /// Quick SOFA. Each criterion scores 1: RR ≥ 22, altered mentation, SBP ≤ 100.
    public static func qSOFA(rr: Int, alteredMentation: Bool, sbp: Int) -> Int {
        (rr >= 22 ? 1 : 0) + (alteredMentation ? 1 : 0) + (sbp <= 100 ? 1 : 0)
    }
    /// qSOFA ≥ 2 flags high risk of poor outcome from sepsis.
    public static func qSOFAHighRisk(_ score: Int) -> Bool { score >= 2 }

    // MARK: Shock index
    /// HR ÷ SBP. Returns 0 if SBP is 0 to avoid division by zero.
    public static func shockIndex(hr: Int, sbp: Int) -> Double {
        sbp == 0 ? 0 : Double(hr) / Double(sbp)
    }

    // MARK: GCS
    /// Glasgow Coma Scale = eye(1–4) + verbal(1–5) + motor(1–6), each clamped.
    public static func gcs(eye: Int, verbal: Int, motor: Int) -> Int {
        min(max(eye, 1), 4) + min(max(verbal, 1), 5) + min(max(motor, 1), 6)
    }

    // MARK: NEWS2 (RCP National Early Warning Score 2, SpO2 Scale 1)
    /// Aggregate NEWS2 from the seven physiological parameters.
    public static func news2(rr: Int, spo2: Int, onOxygen: Bool, sbp: Int,
                             pulse: Int, alert: Bool, tempC: Double) -> Int {
        news2Respiration(rr) + news2SpO2(spo2) + (onOxygen ? 2 : 0)
            + news2SBP(sbp) + news2Pulse(pulse) + (alert ? 0 : 3) + news2Temp(tempC)
    }

    static func news2Respiration(_ rr: Int) -> Int {
        switch rr {
        case ...8: return 3
        case 9...11: return 1
        case 12...20: return 0
        case 21...24: return 2
        default: return 3
        }
    }
    static func news2SpO2(_ s: Int) -> Int {
        switch s {
        case 96...: return 0
        case 94...95: return 1
        case 92...93: return 2
        default: return 3
        }
    }
    static func news2SBP(_ b: Int) -> Int {
        switch b {
        case ...90: return 3
        case 91...100: return 2
        case 101...110: return 1
        case 111...219: return 0
        default: return 3
        }
    }
    static func news2Pulse(_ p: Int) -> Int {
        switch p {
        case ...40: return 3
        case 41...50: return 1
        case 51...90: return 0
        case 91...110: return 1
        case 111...130: return 2
        default: return 3
        }
    }
    static func news2Temp(_ t: Double) -> Int {
        switch t {
        case ..<35.05: return 3
        case 35.05..<36.05: return 1
        case 36.05..<38.05: return 0
        case 38.05..<39.05: return 1
        default: return 2
        }
    }
}
