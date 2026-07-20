import SwiftUI
import StewardMDWatchCore

/// Drug lookup (design §05): dictation-first search → composition + class. Uses
/// the public Worker (works without a bridged token). Full monograph deep-links
/// to the phone (Phase 3).
struct DrugLookupView: View {
    @StateObject private var model = DrugLookupModel(api: WatchServices.drugAPI)
    @State private var query = ""

    var body: some View {
        List {
            TextField("Search drug", text: $query)
                .onSubmit { Task { await model.search(query) } }
                .listRowBackground(SMDPalette.surface.color)

            switch model.state {
            case .idle:
                Text("Dictate or type a drug name")
                    .font(.caption).foregroundStyle(SMDPalette.text2.color)
            case .loading:
                ProgressView()
            case .empty:
                Text("No matches").foregroundStyle(SMDPalette.text2.color)
            case .error:
                Button("Retry") { Task { await model.search(query) } }
                    .tint(SMDPalette.accent.color)
            case .results(let rows):
                ForEach(rows) { row in
                    NavigationLink {
                        DrugDetailView(composition: row.composition)
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(row.composition).font(.headline)
                                .foregroundStyle(SMDPalette.text1.color)
                            if let c = row.drugClass {
                                Text(c).font(.caption2).foregroundStyle(SMDPalette.ai.color)
                            }
                        }
                    }
                    .listRowBackground(SMDPalette.surface.color)
                }
            }
        }
        .navigationTitle("Drugs")
        .onAppear {
            // Siri "amiodarone dose" prefills + runs the search.
            if let q = WatchServices.store.takePendingDrug(), !q.isEmpty {
                query = q
                Task { await model.search(q) }
            }
        }
    }
}

/// Glanceable clinical quick-facts for one composition (`/structured`). Loads on
/// appear; the full monograph still lives on the phone.
private struct DrugDetailView: View {
    let composition: String
    @State private var facts: DrugFacts?
    @State private var failed = false

    var body: some View {
        List {
            if let f = facts {
                if let s = f.summary, !s.isEmpty {
                    Section { Text(s).font(.caption).foregroundStyle(SMDPalette.text1.color) }
                        .listRowBackground(SMDPalette.surface.color)
                }
                factRow("Adult dose", f.adultDose)
                factRow("Paediatric", f.pedDose)
                factRow("Give", f.administration)
                factRow("Renal", f.renalAdjust)
                factRow("Hepatic", f.hepaticAdjust)
                factRow("Common effects", f.commonSe)
                if let c = f.therapeuticClass, !c.isEmpty {
                    factRow("Class", c)
                }
            } else if failed {
                Text("Couldn't load details — try again on the phone.")
                    .font(.caption).foregroundStyle(SMDPalette.text2.color)
                    .listRowBackground(SMDPalette.surface.color)
            } else {
                HStack { Spacer(); ProgressView(); Spacer() }
                    .listRowBackground(Color.clear)
            }
        }
        .navigationTitle(composition)
        .task { await load() }
    }

    @ViewBuilder private func factRow(_ label: String, _ value: String?) -> some View {
        if let v = value, !v.isEmpty {
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.caption2).bold().foregroundStyle(SMDPalette.ai.color)
                Text(v).font(.caption).foregroundStyle(SMDPalette.text1.color)
            }
            .listRowBackground(SMDPalette.surface.color)
        }
    }

    private func load() async {
        do {
            let r = try await WatchServices.drugAPI.facts(composition)
            if let d = r.data { facts = d } else { failed = true }
        } catch {
            failed = true
        }
    }
}
