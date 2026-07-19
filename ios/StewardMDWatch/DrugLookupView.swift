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
                    VStack(alignment: .leading, spacing: 2) {
                        Text(row.composition).font(.headline)
                            .foregroundStyle(SMDPalette.text1.color)
                        if let c = row.drugClass {
                            Text(c).font(.caption2).foregroundStyle(SMDPalette.ai.color)
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
