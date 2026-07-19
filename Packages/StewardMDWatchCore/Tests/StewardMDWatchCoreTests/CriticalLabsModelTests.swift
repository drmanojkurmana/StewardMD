import XCTest
@testable import StewardMDWatchCore

private final class MemAckStore2: AckStore, @unchecked Sendable {
    var acks: [Ack] = []
    func load() -> [Ack] { acks }
    func save(_ a: [Ack]) { acks = a }
}

@MainActor
final class CriticalLabsModelTests: XCTestCase {
    private func alert(_ id: String, _ sev: String, ts: Double) -> LabAlert {
        LabAlert(id: id, analyte: "K", value: "6.8", units: "mmol/L", refRange: nil,
                 patientLabel: "Bed \(id)", severity: sev, ts: ts)
    }

    func testRanksCriticalFirstThenRecency() {
        let ranked = CriticalLabsModel.rank([
            alert("a", "warning", ts: 100),
            alert("b", "critical", ts: 50),
            alert("c", "critical", ts: 90),
            alert("d", "info", ts: 200)
        ])
        XCTAssertEqual(ranked.map(\.id), ["c", "b", "a", "d"])
    }

    func testIngestSortsAndDedupes() {
        let m = CriticalLabsModel(ackQueue: AckQueue(store: MemAckStore2(), sender: LoggingAckSender()))
        m.ingest(alert("a", "warning", ts: 100))
        m.ingest(alert("b", "critical", ts: 50))
        m.ingest(alert("b", "critical", ts: 50))     // duplicate id
        XCTAssertEqual(m.labs.map(\.id), ["b", "a"])
        XCTAssertEqual(m.unacknowledgedCount, 2)
    }

    func testAcknowledgeReducesUnacknowledgedCount() async {
        let m = CriticalLabsModel(ackQueue: AckQueue(store: MemAckStore2(), sender: LoggingAckSender()))
        m.ingest(alert("b", "critical", ts: 50))
        m.ingest(alert("a", "warning", ts: 100))
        await m.acknowledge(m.labs[0])
        XCTAssertEqual(m.unacknowledgedCount, 1)
        XCTAssertTrue(m.isAcknowledged("b"))
    }

    func testAcknowledgeIdempotent() async {
        let m = CriticalLabsModel(ackQueue: AckQueue(store: MemAckStore2(), sender: LoggingAckSender()))
        m.ingest(alert("b", "critical", ts: 50))
        await m.acknowledge(m.labs[0])
        await m.acknowledge(m.labs[0])
        XCTAssertEqual(m.unacknowledgedCount, 0)
    }
}
