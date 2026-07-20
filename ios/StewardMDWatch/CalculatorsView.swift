import SwiftUI
import StewardMDWatchCore

/// Calculators (design §05):
///  • "Offline" — native formulas that run on the wrist with no phone.
///  • "From your phone" — calculators the doctor starred on the phone; computed on
///    the phone (watchOS lacks JavaScriptCore) and shown here when it's reachable.
///  • "Built-in" — the original bespoke quick scores.
struct CalculatorsView: View {
    @EnvironmentObject private var calcs: CalcsModel

    var body: some View {
        List {
            Section("Offline") {
                // Bespoke Crown-driven quick scores first (best wrist UX)…
                ForEach(CalculatorCatalog.all) { def in
                    NavigationLink(value: CalcRoute(id: def.id)) { calcRow(def.name, def.subtitle) }
                        .listRowBackground(SMDPalette.surface.color)
                }
                // …then the data-driven native formulas.
                ForEach(NativeCalcCatalog.all) { c in
                    NavigationLink {
                        CalcRunnerView(title: c.title, inputs: c.inputs) { c.compute($0) }
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
                                await WatchConnectivityManager.shared.computeOnPhone(src: c.computeSrc, values: values)
                            }
                        } label: { calcRow(c.title, c.category ?? "") }
                        .listRowBackground(SMDPalette.surface.color)
                    }
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
/// from the (async) `compute`. Native calcs return instantly; relayed favorites
/// await the phone.
struct CalcRunnerView: View {
    let title: String
    let inputs: [CalcField]
    let compute: ([String: Any]) async -> CalcOutput

    @State private var numbers: [String: Double] = [:]
    @State private var selects: [String: String] = [:]
    @State private var checks: [String: Bool] = [:]
    @State private var output: CalcOutput?

    private var values: [String: Any] {
        var v: [String: Any] = [:]
        numbers.forEach { v[$0.key] = $0.value }
        selects.forEach { v[$0.key] = $0.value }
        checks.forEach { v[$0.key] = $0.value }
        return v
    }
    // Recompute whenever any input changes (drives `.task(id:)`).
    private var signature: String {
        numbers.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: ",")
        + "|" + selects.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: ",")
        + "|" + checks.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: ",")
    }

    var body: some View {
        List {
            ForEach(inputs) { field(for: $0) }
            resultFooter
        }
        .navigationTitle(title)
        .onAppear(perform: seedDefaults)
        .task(id: signature) { output = await compute(values) }
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
            if let output {
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
            } else {
                Text("Enter values…").font(.caption2).foregroundStyle(SMDPalette.text2.color)
            }
        }
        .listRowBackground(Color.clear)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(output.map { $0.error ?? "\($0.value) \($0.unit). \($0.interp)" } ?? "Enter values")
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
