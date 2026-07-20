import SwiftUI
import StewardMDWatchCore

/// Calculators (design §05). "From your phone" = calculators the doctor starred
/// on the phone (relayed, run on-device via the JS engine). "Built-in" = the
/// always-offline quick scores with bespoke Crown input.
struct CalculatorsView: View {
    @EnvironmentObject private var calcs: CalcsModel

    var body: some View {
        List {
            if !calcs.calcs.isEmpty {
                Section("From your phone") {
                    ForEach(calcs.calcs) { c in
                        NavigationLink { RelayedCalcView(calc: c) } label: {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(c.title).font(.headline).foregroundStyle(SMDPalette.text1.color)
                                if let cat = c.category, !cat.isEmpty {
                                    Text(cat).font(.caption2).foregroundStyle(SMDPalette.text2.color)
                                }
                            }
                        }
                        .listRowBackground(SMDPalette.surface.color)
                    }
                }
            } else {
                Section {
                    Text("Star calculators in the phone app to use them here.")
                        .font(.caption2).foregroundStyle(SMDPalette.text2.color)
                        .listRowBackground(SMDPalette.surface.color)
                }
            }

            Section("Built-in") {
                ForEach(CalculatorCatalog.all) { def in
                    NavigationLink(value: CalcRoute(id: def.id)) {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(def.name).font(.headline).foregroundStyle(SMDPalette.text1.color)
                            Text(def.subtitle).font(.caption2).foregroundStyle(SMDPalette.text2.color)
                        }
                    }
                    .listRowBackground(SMDPalette.surface.color)
                }
            }
        }
        .navigationTitle("Calculators")
    }
}

/// Generic detail for a relayed calculator: renders each declared input and shows
/// a live result computed by `CalcsModel` (JavaScriptCore). No per-calc Swift.
private struct RelayedCalcView: View {
    let calc: RelayedCalc
    @EnvironmentObject private var calcs: CalcsModel
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
    private var output: CalcOutput { calcs.run(calc, values: values) }

    var body: some View {
        List {
            ForEach(calc.inputs) { field(for: $0) }
            resultFooter
        }
        .navigationTitle(calc.title)
        .onAppear(perform: seedDefaults)
    }

    @ViewBuilder private func field(for f: CalcField) -> some View {
        switch f.type {
        case "check":
            Toggle(f.label, isOn: Binding(
                get: { checks[f.id] ?? false },
                set: { checks[f.id] = $0 }))
                .listRowBackground(SMDPalette.surface.color)
        case "select":
            Picker(f.label, selection: Binding(
                get: { selects[f.id] ?? (f.opts?.first?.v ?? "") },
                set: { selects[f.id] = $0 })) {
                ForEach(f.opts ?? [], id: \.v) { Text($0.t).tag($0.v) }
            }
            .listRowBackground(SMDPalette.surface.color)
        default: // number
            HStack {
                Text(f.label).font(.caption)
                Spacer()
                TextField("—", value: Binding(
                    get: { numbers[f.id] ?? (f.def ?? 0) },
                    set: { numbers[f.id] = $0 }), format: .number)
                    .multilineTextAlignment(.trailing)
                    .frame(maxWidth: 70)
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
        for f in calc.inputs where f.type == "select" && selects[f.id] == nil {
            selects[f.id] = f.opts?.first?.v ?? ""
        }
        for f in calc.inputs where f.type == "number" && numbers[f.id] == nil {
            if let d = f.def { numbers[f.id] = d }
        }
    }
}
