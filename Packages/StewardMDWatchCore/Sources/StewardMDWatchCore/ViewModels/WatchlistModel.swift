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

    /// One patient in the list per shared unit, so the UI can offer unit tabs.
    public struct UnitGroup: Identifiable, Sendable, Equatable {
        public let id: String            // unit name (== tab label)
        public let kind: String?         // "icu" | "ward" | nil
        public let entries: [WatchlistEntry]
    }

    /// Patients grouped by unit (severity order preserved within each), ordered
    /// ICU units first, then wards, then any untagged ("Current"). Empty when no
    /// patients; a single group when only one unit is present (no tabs needed).
    public var unitGroups: [UnitGroup] {
        var order: [String] = []
        var kinds: [String: String?] = [:]
        var buckets: [String: [WatchlistEntry]] = [:]
        for e in entries {
            let u = (e.unit?.isEmpty == false ? e.unit! : nil) ?? "Current"
            if buckets[u] == nil { buckets[u] = []; order.append(u); kinds[u] = e.unitKind }
            buckets[u, default: []].append(e)
        }
        func rank(_ k: String?) -> Int { k == "icu" ? 0 : (k == "ward" ? 1 : 2) }
        return order
            .sorted { a, b in
                let ra = rank(kinds[a] ?? nil), rb = rank(kinds[b] ?? nil)
                return ra != rb ? ra < rb : a < b
            }
            .map { UnitGroup(id: $0, kind: kinds[$0] ?? nil, entries: buckets[$0] ?? []) }
    }
}
