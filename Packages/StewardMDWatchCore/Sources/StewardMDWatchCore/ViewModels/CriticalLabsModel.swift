import Foundation
import Combine

/// Drives the Critical Labs screen (design §05): a severity-then-recency ranked
/// list of unacknowledged alerts, with an optimistic, offline-queued acknowledge.
@MainActor
public final class CriticalLabsModel: ObservableObject {
    @Published public private(set) var labs: [LabAlert] = []
    @Published public private(set) var acknowledgedIDs: Set<String> = []

    private let ackQueue: AckQueue

    public init(ackQueue: AckQueue = AckQueue()) {
        self.ackQueue = ackQueue
    }

    /// Critical → warning → other; then most-recent first.
    public static func rank(_ alerts: [LabAlert]) -> [LabAlert] {
        alerts.sorted { lhs, rhs in
            let l = severityRank(lhs.severity), r = severityRank(rhs.severity)
            if l != r { return l < r }
            return (lhs.ts ?? 0) > (rhs.ts ?? 0)
        }
    }

    private static func severityRank(_ s: String) -> Int {
        switch s.lowercased() {
        case "critical": return 0
        case "warning", "abnormal": return 1
        default: return 2
        }
    }

    public func ingest(_ alert: LabAlert) { ingest([alert]) }

    public func ingest(_ incoming: [LabAlert]) {
        var byID = Dictionary(labs.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        for a in incoming { byID[a.id] = a }
        labs = Self.rank(Array(byID.values))
    }

    public var unacknowledgedCount: Int {
        labs.filter { !acknowledgedIDs.contains($0.id) }.count
    }

    public func isAcknowledged(_ id: String) -> Bool { acknowledgedIDs.contains(id) }

    /// Optimistically marks acknowledged, then queues the durable ack.
    public func acknowledge(_ alert: LabAlert, now: Date = Date()) async {
        guard !acknowledgedIDs.contains(alert.id) else { return }
        acknowledgedIDs.insert(alert.id)
        let ack = Ack(id: "ack-\(alert.id)", labId: alert.id,
                      patientLabel: alert.patientLabel, ackedAt: now.timeIntervalSince1970)
        await ackQueue.enqueue(ack)
        await ackQueue.flush()
    }
}
