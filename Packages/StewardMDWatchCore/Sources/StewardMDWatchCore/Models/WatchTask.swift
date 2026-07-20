import Foundation

/// A round task relayed from a shared ICU/ward unit (design: Head→JR flow).
/// Assembled on the phone from `SMD_ICU_GROUPS`; the watch ranks + renders and
/// writes status changes back. `id` IS the raw Firestore task id (globally
/// unique), so it doubles as the write-back `taskId`.
public struct WatchTask: Codable, Sendable, Identifiable, Equatable, Hashable {
    public let id: String
    public let groupId: String
    public let patientId: String
    public let patientLabel: String?
    public let text: String
    public let priority: String   // immediate | high | moderate | low
    public let status: String     // pending | progress | done
    public let assignedByName: String?
    public let assignedToUid: String?
    public let dueAt: Double?
    public let ts: Double?

    public init(id: String, groupId: String, patientId: String, patientLabel: String?,
                text: String, priority: String, status: String, assignedByName: String?,
                assignedToUid: String?, dueAt: Double?, ts: Double?) {
        self.id = id; self.groupId = groupId; self.patientId = patientId
        self.patientLabel = patientLabel; self.text = text; self.priority = priority
        self.status = status; self.assignedByName = assignedByName
        self.assignedToUid = assignedToUid; self.dueAt = dueAt; self.ts = ts
    }
}

/// A status change the watch sends back to the phone (→ SMD_ICU_GROUPS.setTaskStatus).
public struct WatchTaskAction: Codable, Sendable, Equatable {
    public let groupId: String
    public let patientId: String
    public let taskId: String
    public let status: String
    public init(groupId: String, patientId: String, taskId: String, status: String) {
        self.groupId = groupId; self.patientId = patientId; self.taskId = taskId; self.status = status
    }
}
