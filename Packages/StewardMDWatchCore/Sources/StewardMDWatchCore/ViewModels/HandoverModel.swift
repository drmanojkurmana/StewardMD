import Foundation
import Combine

/// Handover assistant (design §06): assembles the sick-list at shift end —
/// flagged patients first — and tracks what's been handed off. SBAR-ready and
/// transferable to the incoming doctor.
@MainActor
public final class HandoverModel: ObservableObject {
    @Published public private(set) var items: [WatchlistEntry] = []
    @Published public private(set) var handedOff: Set<String> = []

    public init() {}

    /// Flagged (warning/critical) first — sickest within each group — then stable.
    public func assemble(from entries: [WatchlistEntry]) {
        items = entries.sorted { lhs, rhs in
            let lf = lhs.severity != .success, rf = rhs.severity != .success
            if lf != rf { return lf }                       // flagged before stable
            return (lhs.news2 ?? -1) > (rhs.news2 ?? -1)     // sicker first within group
        }
        handedOff = []
    }

    public func toggle(_ id: String) {
        if handedOff.contains(id) { handedOff.remove(id) } else { handedOff.insert(id) }
    }
    public func isHandedOff(_ id: String) -> Bool { handedOff.contains(id) }

    public var flaggedCount: Int { items.filter { $0.severity != .success }.count }
    public var allHandedOff: Bool { !items.isEmpty && handedOff.count == items.count }
    public var footer: String { "\(items.count) patients · \(flaggedCount) flagged" }
}
