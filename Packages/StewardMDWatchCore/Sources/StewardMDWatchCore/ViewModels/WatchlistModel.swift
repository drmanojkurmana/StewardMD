import Foundation
import Combine

/// Patient watchlist (design §05 "My patients"): sickest first by NEWS2. Fed by
/// relayed/cached data (GHIS/ICU come via the phone; the watch ranks + renders).
@MainActor
public final class WatchlistModel: ObservableObject {
    @Published public private(set) var entries: [WatchlistEntry] = []

    public init() {}

    public func set(_ incoming: [WatchlistEntry]) {
        entries = incoming.sorted { ($0.news2 ?? -1) > ($1.news2 ?? -1) }
    }

    /// Patients whose severity is warning or critical (NEWS2 ≥ 5).
    public var flaggedCount: Int {
        entries.filter { $0.severity != .success }.count
    }

    public var sickest: WatchlistEntry? { entries.first }
}
