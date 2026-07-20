import SwiftUI
import StewardMDWatchCore

/// Calculators (design §05):
///  • "Offline" — native formulas that run on the wrist with no phone.
///  • "From your phone" — calculators the doctor starred on the phone (relayed;
///    computed on the phone since watchOS lacks JavaScriptCore).
///  • "Built-in" — the original bespoke quick scores.
struct CalculatorsView: View {
    @EnvironmentObject private var calcs: CalcsModel

    var body: some View {
        List {
            Section("Offline") {
                ForEach(NativeCalcCatalog.all) { c in
                    NavigationLink {
                        CalcRunnerView(title: c.title, inputs: c.inputs, compute: c.compute)
                    } label: { calcRow(c.title, c.category) }
                    .listRowBackground(SMDPalette.surface.color)
                }
            }

            Section("From your phone") {
                if calcs.calcs.isEmpty {
                    Text("Star calculators in the phone app to use them here.")
                        .font(.caption2).foregroundStyle(SMDPalette.text2.color)
                        .listRowBackground(SMDPalette.surface.color)
                } else {
                    ForEach(calcs.calcs) { c in
                        NavigationLink {
                            CalcRunnerView(title: c.title, inputs: c.inputs) { values in
                                calcs.run(c, values: values)
                            }
                        } label: { calcRow(c.title, c.category ?? "") }
                        .listRowBackground(SMDPalette.surface.color)
                    }
                }
            }

            Section("Built-in") {
                ForEach(CalculatorCatalog.all) { def in
                    NavigationLink(value: CalcRoute(id: def.id)) { calcRow(def.name, def.subtitle) }
                        .listRowBackground(SMDPalette.surface.color)
                }
            }
        }
        .navigationTitle("Calculators")
    }

    private func calcRow(_ title: String, _ sub: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(title).font(.headline).foregroundStyle(SMDPalette.text1.color)
            if !sub.isEmpty {
                Text(sub).font(.caption2).foregroundStyle(SMDPalette.text2.color)
            }
        }
    }
}

/// Generic calculator screen: renders declared inputs and shows a live result
/// from the provided `compute`. Used by both native (Swift) and relayed calcs.
struct CalcRunnerView: View {
    let title: String
    let inputs: [CalcField]
    let compute: ([String: Any]) -> CalcOutput

    @State private var numbers: [String: Double] = [:]
    @State private var selects: [String: String] = [:]
    @State private var checks: [String: Bool] = [:]

    private var values: [String: Any] {
        var v: [String: Any] = [:]
        numbers.forEach { v[$0.key] = $0.value }
        selects.forEach { v[$0.key] = $0.value }
        checks.forEach { v[$0.key] = $0.value }
        return v
    }
    private var output: CalcOutput { compute(values) }

    var body: some View {
        List {
            ForEach(inputs) { field(for: $0) }
            resultFooter
        }
        .navigationTitle(title)
        .onAppear(perform: seedDefaults)
    }

    @ViewBuilder private func field(for f: CalcField) -> some View {
        switch f.type {
        case "check":
            Toggle(f.label, isOn: Binding(get: { checks[f.id] ?? false }, set: { checks[f.id] = $0 }))
                .listRowBackground(SMDPalette.surface.color)
        case "select":
            Picker(f.label, selection: Binding(
                get: { selects[f.id] ?? (f.opts?.first?.v ?? "") },
                set: { selects[f.id] = $0 })) {
                ForEach(f.opts ?? [], id: \.v) { Text($0.t).tag($0.v) }
            }
            .listRowBackground(SMDPalette.surface.color)
        default:
            HStack {
                Text(f.label).font(.caption)
                Spacer()
                TextField("—", value: Binding(
                    get: { numbers[f.id] ?? (f.def ?? 0) },
                    set: { numbers[f.id] = $0 }), format: .number)
                    .multilineTextAlignment(.trailing).frame(maxWidth: 70)
                if let u = f.unit, !u.isEmpty {
                    Text(u).font(.caption2).foregroundStyle(SMDPalette.text2.color)
                }
            }
            .listRowBackground(SMDPalette.surface.color)
        }
    }

    @ViewBuilder private var resultFooter: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let err = output.error {
                Text(err).font(.caption).foregroundStyle(SMDPalette.text2.color)
            } else {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(output.value).font(.system(.title2, design: .rounded)).bold().monospacedDigit()
                        .foregroundStyle(SMDPalette.accent.color)
                    if !output.unit.isEmpty {
                        Text(output.unit).font(.caption2).foregroundStyle(SMDPalette.text2.color)
                    }
                }
                if !output.interp.isEmpty {
                    Text(output.interp).font(.caption2).foregroundStyle(SMDPalette.text1.color)
                }
            }
        }
        .listRowBackground(Color.clear)
    }

    private func seedDefaults() {
        for f in inputs where f.type == "select" && selects[f.id] == nil {
            selects[f.id] = f.opts?.first?.v ?? ""
        }
        for f in inputs where f.type == "number" && numbers[f.id] == nil {
            if let d = f.def { numbers[f.id] = d }
        }
    }
}
