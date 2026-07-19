import SwiftUI
import StewardMDWatchCore

/// Calculators (design §05): favorite calculators first, Crown-driven input.
struct CalculatorsView: View {
    @EnvironmentObject private var favorites: FavoritesStore

    private var favoriteDefs: [CalculatorDef] {
        CalculatorCatalog.all.filter { favorites.isFavorite($0.id) }
    }
    private var otherDefs: [CalculatorDef] {
        CalculatorCatalog.all.filter { !favorites.isFavorite($0.id) }
    }

    var body: some View {
        List {
            if !favoriteDefs.isEmpty {
                Section("Favorites") { ForEach(favoriteDefs) { row($0) } }
            }
            Section(favoriteDefs.isEmpty ? "" : "All") { ForEach(otherDefs) { row($0) } }
        }
        .navigationTitle("Calculators")
    }

    private func row(_ def: CalculatorDef) -> some View {
        NavigationLink(value: CalcRoute(id: def.id)) {
            HStack {
                VStack(alignment: .leading, spacing: 1) {
                    Text(def.name).font(.headline).foregroundStyle(SMDPalette.text1.color)
                    Text(def.subtitle).font(.caption2).foregroundStyle(SMDPalette.text2.color)
                }
                Spacer()
                Button {
                    favorites.toggle(def.asFavorite)
                } label: {
                    Image(systemName: favorites.isFavorite(def.id) ? "star.fill" : "star")
                        .foregroundStyle(SMDPalette.warning.color)
                }
                .buttonStyle(.plain)
            }
        }
        .listRowBackground(SMDPalette.surface.color)
    }
}
