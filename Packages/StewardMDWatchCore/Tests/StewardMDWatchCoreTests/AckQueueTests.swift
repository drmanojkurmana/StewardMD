import XCTest
@testable import StewardMDWatchCore

private final class MemAckStore: AckStore, @unchecked Sendable {
    var acks: [Ack] = []
    func load() -> [Ack] { acks }
    func save(_ a: [Ack]) { acks = a }
}

/// Sender that fails its first `failFor` attempts, then succeeds. Records calls.
private actor FlakySender: AckSender {
    private var remainingFailures: Int
    private(set) var attempts = 0
    init(failFor: Int) { remainingFailures = failFor }
    func send(_ ack: Ack) async -> Bool {
        attempts += 1
        if remainingFailures > 0 { remainingFailures -= 1; return false }
        return true
    }
    func attemptCount() -> Int { attempts }
}

final class AckQueueTests: XCTestCase {
    private func ack(_ id: String) -> Ack {
        Ack(id: id, labId: "L\(id)", patientLabel: "Bed 12", ackedAt: 1)
    }

    func testEnqueueDedupesSameID() async {
        let q = AckQueue(store: MemAckStore(), sender: FlakySender(failFor: 99))
        await q.enqueue(ack("a"))
        await q.enqueue(ack("a"))
        let n = await q.pendingCount
        XCTAssertEqual(n, 1)
    }

    func testFlushKeepsPendingWhenSenderFails() async {
        let q = AckQueue(store: MemAckStore(), sender: FlakySender(failFor: 99))
        await q.enqueue(ack("a"))
        await q.flush()
        let n = await q.pendingCount
        XCTAssertEqual(n, 1)
    }

    func testFlushDrainsWhenSenderSucceeds() async {
        let q = AckQueue(store: MemAckStore(), sender: FlakySender(failFor: 0))
        await q.enqueue(ack("a"))
        await q.enqueue(ack("b"))
        await q.flush()
        let n = await q.pendingCount
        XCTAssertEqual(n, 0)
    }

    func testRetryAfterTransientFailure() async {
        let sender = FlakySender(failFor: 1)
        let q = AckQueue(store: MemAckStore(), sender: sender)
        await q.enqueue(ack("a"))
        await q.flush()                              // first attempt fails
        let afterFirst = await q.pendingCount
        XCTAssertEqual(afterFirst, 1)
        await q.flush()                              // second attempt succeeds
        let afterSecond = await q.pendingCount
        XCTAssertEqual(afterSecond, 0)
    }

    func testPersistsAcrossReload() async {
        let store = MemAckStore()
        let q1 = AckQueue(store: store, sender: FlakySender(failFor: 99))
        await q1.enqueue(ack("a"))
        // A fresh queue backed by the same store sees the pending ack.
        let q2 = AckQueue(store: store, sender: FlakySender(failFor: 99))
        let n = await q2.pendingCount
        XCTAssertEqual(n, 1)
    }
}
