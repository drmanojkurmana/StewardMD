import Foundation

/// A clinical task / follow-up reminder (design §01 "Tasks & clinical reminders").
public struct TaskItem: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let text: String
    public let patientLabel: String?
    public let dueAt: Double?
    public var done: Bool

    public init(id: String, text: String, patientLabel: String?, dueAt: Double?, done: Bool = false) {
        self.id = id; self.text = text; self.patientLabel = patientLabel
        self.dueAt = dueAt; self.done = done
    }

    public func isOverdue(now: Date = Date()) -> Bool {
        guard let d = dueAt, !done else { return false }
        return now.timeIntervalSince1970 > d
    }
}
