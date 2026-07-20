import XCTest
@testable import StewardMDWatchCore

final class WatchTaskTests: XCTestCase {
    func testDecodesFromRelayPayload() throws {
        let j = #"{"id":"t1","groupId":"g1","patientId":"p1","patientLabel":"Bed 3 · Okafor","text":"Repeat ABG","priority":"high","status":"pending","assignedByName":"Dr Head","assignedToUid":"u2","dueAt":123.0,"ts":100.0}"#
        let t = try JSONDecoder().decode(WatchTask.self, from: Data(j.utf8))
        XCTAssertEqual(t.id, "t1")
        XCTAssertEqual(t.priority, "high")
        XCTAssertEqual(t.status, "pending")
        XCTAssertEqual(t.patientLabel, "Bed 3 · Okafor")
    }
}

@MainActor
final class TasksModelTests: XCTestCase {
    private func t(_ id: String, priority: String = "moderate", status: String = "pending",
                   assignedTo: String? = nil, dueAt: Double? = nil, ts: Double = 0) -> WatchTask {
        WatchTask(id: id, groupId: "g", patientId: "p", patientLabel: "Bed 1",
                  text: id, priority: priority, status: status, assignedByName: "Head",
                  assignedToUid: assignedTo, dueAt: dueAt, ts: ts)
    }

    func testRanksOverdueThenPriorityThenRecency() {
        let m = TasksModel()
        m.ingest([
            t("low", priority: "low", ts: 10),
            t("imm", priority: "immediate", ts: 5),
            t("overdue", priority: "low", dueAt: 50, ts: 1)
        ], now: 100)
        XCTAssertEqual(m.tasks.map(\.id), ["overdue", "imm", "low"])
    }

    func testOpenCountExcludesDone() {
        let m = TasksModel()
        m.ingest([t("a"), t("b", status: "done")], now: 100)
        XCTAssertEqual(m.openCount, 1)
    }

    func testDropsDoneOlderThanSixHours() {
        let m = TasksModel()
        let sixHoursAgo = 100.0 - 6.5 * 3600
        m.ingest([t("old", status: "done", ts: sixHoursAgo), t("open")], now: 100)
        XCTAssertEqual(m.tasks.map(\.id), ["open"])
    }

    func testVisibilityExecutorSeesAssignedAndUnassigned() {
        let m = TasksModel()
        m.ingest([t("mine", assignedTo: "me"), t("theirs", assignedTo: "other"), t("free")], now: 100)
        let v = m.visibleTasks(myUid: "me", canInstruct: false).map(\.id).sorted()
        XCTAssertEqual(v, ["free", "mine"])
    }

    func testVisibilityInstructorSeesAll() {
        let m = TasksModel()
        m.ingest([t("mine", assignedTo: "me"), t("theirs", assignedTo: "other")], now: 100)
        XCTAssertEqual(m.visibleTasks(myUid: "me", canInstruct: true).count, 2)
    }

    func testSetStatusOptimisticAndEmitsAction() {
        let m = TasksModel()
        m.ingest([t("a")], now: 100)
        var captured: WatchTaskAction?
        m.onAction = { captured = $0 }
        m.setStatus(m.tasks[0], to: "done", now: 200)
        XCTAssertEqual(m.tasks.first { $0.id == "a" }?.status, "done")
        XCTAssertEqual(captured?.taskId, "a")
        XCTAssertEqual(captured?.status, "done")
    }
}
