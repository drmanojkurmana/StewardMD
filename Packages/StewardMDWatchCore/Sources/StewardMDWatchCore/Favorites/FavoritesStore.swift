import Foundation
import Combine

/// Watch-local favorites (the offline default half of the favorites decision),
/// persisted to the App Group so widgets can read them and the iPhone bridge can
/// reconcile with the backend-backed favorites feature (Phase 6).
@MainActor
public final class FavoritesStore: ObservableObject {
    @Published public private(set) var favorites: [Favorite]
    private let appGroup: AppGroupStore

    public init(appGroup: AppGroupStore = AppGroupStore()) {
        self.appGroup = appGroup
        self.favorites = appGroup.loadFavorites()
    }

    public func isFavorite(_ id: String) -> Bool {
        favorites.contains { $0.id == id }
    }

    public func toggle(_ fav: Favorite) {
        if let i = favorites.firstIndex(where: { $0.id == fav.id }) {
            favorites.remove(at: i)
        } else {
            favorites.append(fav)
        }
        appGroup.saveFavorites(favorites)
    }
}
