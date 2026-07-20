import Foundation
import Combine

/// Drives the watch Tasks screen: rank (overdue → priority → recency), filter by
/// role/assignee, and optimistic status changes that write back via `onAction`.
@MainActor
public final class TasksModel: ObservableObject {
    @Published public private(set) var tasks: [WatchTask] = []

    /// Called with the change to relay to the phone (WCSession on the app side).
    public var onAction: ((WatchTaskAction) -> Void)?

    public init() {}

    private static let doneGrace: Double = 6 * 3600

    public func ingest(_ incoming: [WatchTask], now: Double = Date().timeIntervalSince1970) {
        var byID = Dictionary(tasks.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        for t in incoming { byID[t.id] = t }
        let fresh = byID.values.filter { t in
            t.status != "done" || (t.ts.map { now - $0 < Self.doneGrace } ?? true)
        }
        tasks = Self.rank(Array(fresh), now: now)
    }

    public var openCount: Int { tasks.filter { $0.status != "done" }.count }

    public func visibleTasks(myUid: String?, canInstruct: Bool) -> [WatchTask] {
        if canInstruct { return tasks }
        return tasks.filter { $0.assignedToUid == nil || $0.assignedToUid == myUid }
    }

    public func setStatus(_ task: WatchTask, to status: String,
                          now: Double = Date().timeIntervalSince1970) {
        guard let i = tasks.firstIndex(where: { $0.id == task.id }) else { return }
        let t = tasks[i]
        tasks[i] = WatchTask(id: t.id, groupId: t.groupId, patientId: t.patientId,
                             patientLabel: t.patientLabel, text: t.text, priority: t.priority,
                             status: status, assignedByName: t.assignedByName,
                             assignedToUid: t.assignedToUid, dueAt: t.dueAt, ts: t.ts)
        tasks = Self.rank(tasks, now: now)
        onAction?(WatchTaskAction(groupId: t.groupId, patientId: t.patientId,
                                  taskId: t.id, status: status))
    }

    static func rank(_ ts: [WatchTask], now: Double) -> [WatchTask] {
        ts.sorted { a, b in
            let ao = (a.dueAt.map { $0 < now } ?? false), bo = (b.dueAt.map { $0 < now } ?? false)
            if ao != bo { return ao }                       // overdue first
            let ap = priorityRank(a.priority), bp = priorityRank(b.priority)
            if ap != bp { return ap < bp }                  // then priority
            return (a.ts ?? 0) > (b.ts ?? 0)                // then recency
        }
    }

    private static func priorityRank(_ p: String) -> Int {
        switch p { case "immediate": return 0; case "high": return 1
                   case "moderate": return 2; default: return 3 }
    }
}
