import SwiftUI
import StewardMDWatchCore

/// Bespoke Crown-driven input per calculator, with a live score + interpretation
/// (design §05). Screening support only — the app's safety framing applies.
struct CalculatorDetailView: View {
    let id: String

    var body: some View {
        Group {
            switch id {
            case "qsofa": QSOFACalc()
            case "shock": ShockCalc()
            case "gcs": GCSCalc()
            case "news2": NEWS2Calc()
            default: Text("Unknown calculator")
            }
        }
        .navigationTitle(CalculatorCatalog.def(id)?.name ?? "Calculator")
    }
}

// MARK: qSOFA — three criteria toggles
private struct QSOFACalc: View {
    @State private var rr = false, mentation = false, sbp = false
    private var score: Int {
        CalculatorEngine.qSOFA(rr: rr ? 24 : 12, alteredMentation: mentation, sbp: sbp ? 90 : 120)
    }
    var body: some View {
        List {
            Toggle("RR ≥ 22", isOn: $rr)
            Toggle("Altered mentation", isOn: $mentation)
            Toggle("SBP ≤ 100", isOn: $sbp)
            ScoreFooter(value: "\(score)/3",
                        tier: CalculatorEngine.qSOFAHighRisk(score) ? .warning : .success,
                        note: CalculatorEngine.qSOFAHighRisk(score) ? "High risk" : "Low risk")
        }
    }
}

// MARK: Shock index — HR & SBP dialed with the Crown
private struct ShockCalc: View {
    @State private var hr = 90.0
    @State private var sbp = 120.0
    private var index: Double { CalculatorEngine.shockIndex(hr: Int(hr), sbp: Int(sbp)) }
    var body: some View {
        List {
            CrownRow(label: "HR", value: $hr, range: 20...220, step: 1)
            CrownRow(label: "SBP", value: $sbp, range: 40...260, step: 1)
            ScoreFooter(value: String(format: "%.2f", index),
                        tier: index >= 1.0 ? .warning : .success,
                        note: index >= 1.0 ? "Elevated" : "Normal")
        }
    }
}

// MARK: GCS — eye/verbal/motor steppers
private struct GCSCalc: View {
    @State private var eye = 4, verbal = 5, motor = 6
    private var score: Int { CalculatorEngine.gcs(eye: eye, verbal: verbal, motor: motor) }
    var body: some View {
        List {
            Stepper("Eye \(eye)", value: $eye, in: 1...4)
            Stepper("Verbal \(verbal)", value: $verbal, in: 1...5)
            Stepper("Motor \(motor)", value: $motor, in: 1...6)
            ScoreFooter(value: "\(score)/15",
                        tier: score <= 8 ? .critical : (score <= 12 ? .warning : .success),
                        note: score <= 8 ? "Severe" : (score <= 12 ? "Moderate" : "Mild"))
        }
    }
}

// MARK: NEWS2 — compact vitals entry
private struct NEWS2Calc: View {
    @State private var rr = 16.0, spo2 = 98.0, sbp = 120.0, pulse = 70.0, temp = 37.0
    @State private var onOxygen = false, alert = true
    private var score: Int {
        CalculatorEngine.news2(rr: Int(rr), spo2: Int(spo2), onOxygen: onOxygen,
                               sbp: Int(sbp), pulse: Int(pulse), alert: alert, tempC: temp)
    }
    var body: some View {
        List {
            CrownRow(label: "RR", value: $rr, range: 4...50, step: 1)
            CrownRow(label: "SpO₂", value: $spo2, range: 50...100, step: 1)
            CrownRow(label: "SBP", value: $sbp, range: 40...260, step: 1)
            CrownRow(label: "Pulse", value: $pulse, range: 20...220, step: 1)
            CrownRow(label: "Temp", value: $temp, range: 32...42, step: 0.1)
            Toggle("On oxygen", isOn: $onOxygen)
            Toggle("Alert (ACVPU)", isOn: $alert)
            ScoreFooter(value: "\(score)",
                        tier: score >= 7 ? .critical : (score >= 5 ? .warning : .success),
                        note: score >= 7 ? "High" : (score >= 5 ? "Medium" : "Low"))
        }
    }
}

// MARK: shared bits
private struct CrownRow: View {
    let label: String
    @Binding var value: Double
    let range: ClosedRange<Double>
    let step: Double
    var body: some View {
        HStack {
            Text(label)
            Spacer()
            Text(step < 1 ? String(format: "%.1f", value) : "\(Int(value))")
                .monospacedDigit().foregroundStyle(SMDPalette.accent.color)
        }
        .focusable()
        .digitalCrownRotation($value, from: range.lowerBound, through: range.upperBound,
                              by: step, sensitivity: .medium)
    }
}

private struct ScoreFooter: View {
    let value: String
    let tier: SMDHapticTier
    let note: String
    var body: some View {
        HStack {
            Text(value).font(.system(.title2, design: .rounded)).bold().monospacedDigit()
            Spacer()
            SeverityChip(tier: tier, text: note)
        }
        .listRowBackground(Color.clear)
    }
}
