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
        let fav = favorites.isFavorite(def.id)
        return NavigationLink(value: CalcRoute(id: def.id)) {
            HStack {
                VStack(alignment: .leading, spacing: 1) {
                    Text(def.name).font(.headline).foregroundStyle(SMDPalette.text1.color)
                    Text(def.subtitle).font(.caption2).foregroundStyle(SMDPalette.text2.color)
                }
                Spacer()
                if fav {
                    Image(systemName: "star.fill")
                        .foregroundStyle(SMDPalette.warning.color)
                        .accessibilityLabel("Favorite")
                }
            }
        }
        .listRowBackground(SMDPalette.surface.color)
        // Favoriting is a swipe action so it can't fight the row's navigation tap.
        .swipeActions(edge: .leading) {
            Button {
                favorites.toggle(def.asFavorite)
            } label: {
                Label(fav ? "Unfavorite" : "Favorite", systemImage: fav ? "star.slash" : "star")
            }
            .tint(SMDPalette.warning.color)
        }
    }
}
