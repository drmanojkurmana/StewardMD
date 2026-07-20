import Foundation

/// A calculator that runs FULLY OFFLINE on the watch via a native Swift formula
/// (no JavaScriptCore, which watchOS lacks). Inputs reuse `CalcField` so the same
/// generic screen renders native and relayed calculators alike. Formulas are the
/// standard published ones; keep them in sync with calculators.js.
public struct NativeCalc: Identifiable, Sendable {
    public let id: String
    public let title: String
    public let category: String
    public let inputs: [CalcField]
    public let compute: @Sendable ([String: Any]) -> CalcOutput

    public init(id: String, title: String, category: String,
                inputs: [CalcField], compute: @escaping @Sendable ([String: Any]) -> CalcOutput) {
        self.id = id; self.title = title; self.category = category
        self.inputs = inputs; self.compute = compute
    }
}

/// Value readers for compute closures.
private func num(_ v: [String: Any], _ k: String) -> Double? {
    if let d = v[k] as? Double { return d }
    if let i = v[k] as? Int { return Double(i) }
    return nil
}
private func flag(_ v: [String: Any], _ k: String) -> Bool { (v[k] as? Bool) ?? false }
private func need(_ msg: String = "Enter all required values.") -> CalcOutput {
    CalcOutput(value: "—", unit: "", interp: "", error: msg)
}
private func n(_ id: String, _ label: String, unit: String? = nil, step: Double = 1, def: Double? = nil) -> CalcField {
    CalcField(id: id, label: label, type: "number", unit: unit, step: step, min: 0, def: def, opts: nil)
}
private func chk(_ id: String, _ label: String) -> CalcField {
    CalcField(id: id, label: label, type: "check", unit: nil, step: nil, min: nil, def: nil, opts: nil)
}

/// The offline essentials bundled on the wrist. Each formula is unit-tested.
public enum NativeCalcCatalog {
    public static let all: [NativeCalc] = [

        NativeCalc(id: "map", title: "Mean arterial pressure", category: "Haemodynamics",
                   inputs: [n("sbp", "SBP", unit: "mmHg", def: 120), n("dbp", "DBP", unit: "mmHg", def: 80)]) { v in
            guard let s = num(v, "sbp"), let d = num(v, "dbp"), s > 0, d > 0 else { return need() }
            let map = (s + 2 * d) / 3
            return CalcOutput(value: String(Int(map.rounded())), unit: "mmHg",
                              interp: map < 65 ? "Below 65 — organ perfusion at risk" : "≥65 — adequate perfusion target", error: nil)
        },

        NativeCalc(id: "aniongap", title: "Anion gap", category: "Metabolic",
                   inputs: [n("na", "Na⁺", unit: "mEq/L", def: 140), n("cl", "Cl⁻", unit: "mEq/L", def: 104), n("hco3", "HCO₃⁻", unit: "mEq/L", def: 24)]) { v in
            guard let na = num(v, "na"), let cl = num(v, "cl"), let hco3 = num(v, "hco3") else { return need() }
            let ag = na - (cl + hco3)
            return CalcOutput(value: String(Int(ag.rounded())), unit: "mEq/L",
                              interp: ag > 12 ? "High — raised-anion-gap acidosis (correct for albumin)" : "Normal (8–12)", error: nil)
        },

        NativeCalc(id: "corrca", title: "Corrected calcium", category: "Metabolic",
                   inputs: [n("ca", "Calcium", unit: "mg/dL", step: 0.1, def: 9.0), n("alb", "Albumin", unit: "g/dL", step: 0.1, def: 4.0)]) { v in
            guard let ca = num(v, "ca"), let alb = num(v, "alb") else { return need() }
            let c = ca + 0.8 * (4.0 - alb)
            return CalcOutput(value: String(format: "%.1f", c), unit: "mg/dL",
                              interp: c > 10.5 ? "High" : (c < 8.5 ? "Low" : "Normal (8.5–10.5)"), error: nil)
        },

        NativeCalc(id: "corrna", title: "Corrected sodium (hyperglycaemia)", category: "Metabolic",
                   inputs: [n("na", "Measured Na⁺", unit: "mEq/L", def: 130), n("glu", "Glucose", unit: "mg/dL", def: 100)]) { v in
            guard let na = num(v, "na"), let glu = num(v, "glu") else { return need() }
            let c = na + 1.6 * ((glu - 100) / 100)
            return CalcOutput(value: String(format: "%.1f", c), unit: "mEq/L",
                              interp: "Add 1.6 mEq/L Na per 100 mg/dL glucose above 100", error: nil)
        },

        NativeCalc(id: "crcl", title: "Creatinine clearance (Cockcroft-Gault)", category: "Renal",
                   inputs: [n("age", "Age", unit: "yrs", def: 60), n("wt", "Weight", unit: "kg", def: 70),
                            n("scr", "Creatinine", unit: "mg/dL", step: 0.1, def: 1.0), chk("female", "Female")]) { v in
            guard let age = num(v, "age"), let wt = num(v, "wt"), let scr = num(v, "scr"), scr > 0, age > 0 else { return need() }
            let crcl = ((140 - age) * wt * (flag(v, "female") ? 0.85 : 1.0)) / (72 * scr)
            return CalcOutput(value: String(Int(crcl.rounded())), unit: "mL/min",
                              interp: crcl < 30 ? "Severe impairment" : (crcl < 60 ? "Moderate impairment" : "≥60"), error: nil)
        },

        NativeCalc(id: "bmi", title: "Body mass index", category: "General",
                   inputs: [n("wt", "Weight", unit: "kg", def: 70), n("ht", "Height", unit: "cm", def: 170)]) { v in
            guard let wt = num(v, "wt"), let ht = num(v, "ht"), ht > 0 else { return need() }
            let m = ht / 100, bmi = wt / (m * m)
            let band = bmi < 18.5 ? "Underweight" : (bmi < 25 ? "Normal" : (bmi < 30 ? "Overweight" : "Obese"))
            return CalcOutput(value: String(format: "%.1f", bmi), unit: "kg/m²", interp: band, error: nil)
        },

        NativeCalc(id: "bsa", title: "Body surface area (Mosteller)", category: "General",
                   inputs: [n("ht", "Height", unit: "cm", def: 170), n("wt", "Weight", unit: "kg", def: 70)]) { v in
            guard let ht = num(v, "ht"), let wt = num(v, "wt"), ht > 0, wt > 0 else { return need() }
            let bsa = (ht * wt / 3600).squareRoot()
            return CalcOutput(value: String(format: "%.2f", bsa), unit: "m²", interp: "Mosteller formula", error: nil)
        },

        NativeCalc(id: "winters", title: "Winters' formula", category: "Metabolic",
                   inputs: [n("hco3", "HCO₃⁻", unit: "mEq/L", def: 24)]) { v in
            guard let hco3 = num(v, "hco3") else { return need() }
            let exp = 1.5 * hco3 + 8
            return CalcOutput(value: String(format: "%.0f–%.0f", exp - 2, exp + 2), unit: "mmHg pCO₂",
                              interp: "Measured pCO₂ above range → concurrent respiratory acidosis; below → respiratory alkalosis", error: nil)
        },

        NativeCalc(id: "qtc", title: "QTc (Bazett)", category: "Cardiology",
                   inputs: [n("qt", "QT", unit: "ms", def: 400), n("hr", "Heart rate", unit: "bpm", def: 60)]) { v in
            guard let qt = num(v, "qt"), let hr = num(v, "hr"), hr > 0 else { return need() }
            let rr = 60 / hr
            let qtc = qt / rr.squareRoot()
            return CalcOutput(value: String(Int(qtc.rounded())), unit: "ms",
                              interp: qtc >= 500 ? "≥500 — high torsades risk" : (qtc > 460 ? "Prolonged" : "Normal"), error: nil)
        },

        NativeCalc(id: "curb65", title: "CURB-65", category: "Respiratory",
                   inputs: [chk("conf", "Confusion (new)"), chk("urea", "Urea > 7 mmol/L"),
                            chk("rr", "RR ≥ 30"), chk("bp", "SBP < 90 or DBP ≤ 60"), chk("age", "Age ≥ 65")]) { v in
            let s = [flag(v, "conf"), flag(v, "urea"), flag(v, "rr"), flag(v, "bp"), flag(v, "age")].filter { $0 }.count
            let band = s <= 1 ? "Low — consider outpatient" : (s == 2 ? "Moderate — consider admission" : "Severe — admit; assess ICU")
            return CalcOutput(value: "\(s)", unit: "/5", interp: band, error: nil)
        },

        NativeCalc(id: "wellsdvt", title: "Wells score (DVT)", category: "Haematology",
                   inputs: [chk("cancer", "Active cancer"), chk("immob", "Paralysis/paresis or recent immobilisation"),
                            chk("bed", "Bedridden >3d or major surgery <12wk"), chk("tender", "Tenderness along deep veins"),
                            chk("swell", "Entire leg swollen"), chk("calf", "Calf >3cm larger than other"),
                            chk("edema", "Pitting oedema (symptomatic leg)"), chk("collateral", "Collateral superficial veins"),
                            chk("priordvt", "Previously documented DVT"), chk("altdx", "Alternative dx as likely (−2)")]) { v in
            var s = 0
            for k in ["cancer", "immob", "bed", "tender", "swell", "calf", "edema", "collateral", "priordvt"] where flag(v, k) { s += 1 }
            if flag(v, "altdx") { s -= 2 }
            let band = s >= 3 ? "High probability" : (s >= 1 ? "Moderate" : "Low probability")
            return CalcOutput(value: "\(s)", unit: "points", interp: band, error: nil)
        },

        NativeCalc(id: "wellspe", title: "Wells score (PE)", category: "Respiratory",
                   inputs: [chk("dvt", "Clinical signs of DVT (+3)"), chk("alt", "PE most likely dx (+3)"),
                            chk("hr", "HR >100 (+1.5)"), chk("immob", "Immobilisation/surgery ≤4wk (+1.5)"),
                            chk("prior", "Previous DVT/PE (+1.5)"), chk("hemop", "Haemoptysis (+1)"), chk("malig", "Malignancy (+1)")]) { v in
            var s = 0.0
            if flag(v, "dvt") { s += 3 }; if flag(v, "alt") { s += 3 }; if flag(v, "hr") { s += 1.5 }
            if flag(v, "immob") { s += 1.5 }; if flag(v, "prior") { s += 1.5 }; if flag(v, "hemop") { s += 1 }; if flag(v, "malig") { s += 1 }
            let three = s > 6 ? "High" : (s >= 2 ? "Moderate" : "Low")
            let two = s > 4 ? "PE likely" : "PE unlikely"
            return CalcOutput(value: String(format: "%g", s), unit: "points", interp: "\(three) (3-tier) · \(two) (2-tier)", error: nil)
        },

        NativeCalc(id: "chadsvasc", title: "CHA₂DS₂-VASc", category: "Cardiology",
                   inputs: [n("age", "Age", unit: "yrs", def: 65), chk("female", "Female"), chk("chf", "CHF / LV dysfunction"),
                            chk("htn", "Hypertension"), chk("dm", "Diabetes"), chk("stroke", "Stroke/TIA/TE (+2)"), chk("vasc", "Vascular disease")]) { v in
            guard let age = num(v, "age") else { return need() }
            var s = 0
            if age >= 75 { s += 2 } else if age >= 65 { s += 1 }
            if flag(v, "female") { s += 1 }; if flag(v, "chf") { s += 1 }; if flag(v, "htn") { s += 1 }
            if flag(v, "dm") { s += 1 }; if flag(v, "stroke") { s += 2 }; if flag(v, "vasc") { s += 1 }
            let band = s == 0 ? "Low — no anticoagulation" : (s == 1 ? "Consider anticoagulation" : "Anticoagulation recommended")
            return CalcOutput(value: "\(s)", unit: "points", interp: band, error: nil)
        },

        NativeCalc(id: "hasbled", title: "HAS-BLED", category: "Cardiology",
                   inputs: [chk("htn", "Uncontrolled HTN (SBP >160)"), chk("renal", "Abnormal renal function"),
                            chk("liver", "Abnormal liver function"), chk("stroke", "Stroke history"), chk("bleed", "Bleeding history/predisposition"),
                            chk("inr", "Labile INR"), chk("elderly", "Age >65"), chk("drugs", "Antiplatelet / NSAID"), chk("alcohol", "Alcohol ≥8 units/wk")]) { v in
            var s = 0
            for k in ["htn", "renal", "liver", "stroke", "bleed", "inr", "elderly", "drugs", "alcohol"] where flag(v, k) { s += 1 }
            return CalcOutput(value: "\(s)", unit: "points", interp: s >= 3 ? "High bleeding risk — caution + review" : "Lower risk", error: nil)
        },

        NativeCalc(id: "parkland", title: "Parkland formula (burns)", category: "Emergency",
                   inputs: [n("wt", "Weight", unit: "kg", def: 70), n("tbsa", "TBSA burned", unit: "%", def: 20)]) { v in
            guard let wt = num(v, "wt"), let tbsa = num(v, "tbsa"), wt > 0, tbsa > 0 else { return need() }
            let total = 4 * wt * tbsa
            return CalcOutput(value: String(Int(total.rounded())), unit: "mL / 24h",
                              interp: "Give half (\(Int((total / 2).rounded())) mL) in the first 8h from the burn, rest over 16h. Lactated Ringer's.", error: nil)
        },

        NativeCalc(id: "ibw", title: "Ideal body weight (Devine)", category: "General",
                   inputs: [n("ht", "Height", unit: "cm", def: 170), chk("female", "Female")]) { v in
            guard let ht = num(v, "ht"), ht > 0 else { return need() }
            let inches = ht / 2.54
            let base = flag(v, "female") ? 45.5 : 50.0
            let ibw = base + 2.3 * max(0, inches - 60)
            return CalcOutput(value: String(format: "%.1f", ibw), unit: "kg", interp: "Devine formula", error: nil)
        },

        NativeCalc(id: "maint421", title: "Maintenance fluids (4-2-1)", category: "General",
                   inputs: [n("wt", "Weight", unit: "kg", def: 20)]) { v in
            guard let wt = num(v, "wt"), wt > 0 else { return need() }
            var rate = min(wt, 10) * 4
            if wt > 10 { rate += min(wt - 10, 10) * 2 }
            if wt > 20 { rate += (wt - 20) * 1 }
            return CalcOutput(value: String(Int(rate.rounded())), unit: "mL/h",
                              interp: "Holliday-Segar; daily ≈ \(Int((rate * 24).rounded())) mL", error: nil)
        },

        NativeCalc(id: "aagrad", title: "A–a oxygen gradient", category: "Respiratory",
                   inputs: [n("fio2", "FiO₂", unit: "%", def: 21), n("pao2", "PaO₂", unit: "mmHg", def: 90),
                            n("paco2", "PaCO₂", unit: "mmHg", def: 40), n("age", "Age", unit: "yrs", def: 40)]) { v in
            guard let fio2 = num(v, "fio2"), let pao2 = num(v, "pao2"), let paco2 = num(v, "paco2") else { return need() }
            let pAO2 = (fio2 / 100) * (760 - 47) - paco2 / 0.8
            let aa = pAO2 - pao2
            let expected = (num(v, "age") ?? 40) / 4 + 4
            return CalcOutput(value: String(Int(aa.rounded())), unit: "mmHg",
                              interp: aa > expected ? "Raised (expected ≈\(Int(expected.rounded()))) — V/Q mismatch, shunt or diffusion defect" : "Normal (≈\(Int(expected.rounded())))", error: nil)
        }
    ]

    public static func calc(_ id: String) -> NativeCalc? { all.first { $0.id == id } }
}
