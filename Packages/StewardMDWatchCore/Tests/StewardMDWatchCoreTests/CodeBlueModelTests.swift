import XCTest
@testable import StewardMDWatchCore

@MainActor
final class CodeBlueModelTests: XCTestCase {
    func testCycleAndRhythmDueAfterTwoMinutes() {
        let m = CodeBlueModel()
        XCTAssertFalse(m.tick(119))
        XCTAssertEqual(m.cycle, 1)
        XCTAssertTrue(m.tick(1))              // crosses 120s
        XCTAssertEqual(m.cycle, 2)
    }

    func testLabels() {
        let m = CodeBlueModel()
        m.tick(84)
        XCTAssertEqual(m.elapsedLabel, "1:24")
        // 84s into a 120s cycle → 36s to next rhythm check
        XCTAssertEqual(m.rhythmCountdownLabel, "0:36")
    }

    func testAdrenalineScheduleByCycleParity() {
        let m = CodeBlueModel()
        XCTAssertEqual(m.nextDrug, "Adrenaline 1 mg")     // cycle 1 (odd)
        m.tick(121)                                       // cycle 2 (even)
        XCTAssertTrue(m.nextDrug.contains("Amiodarone"))
    }

    func testSyncToWallClockCrossesBoundary() {
        let m = CodeBlueModel()
        // Wrist down 0 → 130s in one jump (AOD): must report a boundary crossed
        // so the missed rhythm-check haptic still fires on resume.
        XCTAssertTrue(m.sync(to: 130))
        XCTAssertEqual(m.cycle, 2)
        XCTAssertEqual(m.elapsedLabel, "2:10")
        // A further sync within the same cycle does not re-cross.
        XCTAssertFalse(m.sync(to: 150))
    }

    func testSummaryCountsAndROSC() {
        let m = CodeBlueModel()
        m.tick(600)                 // 10 min
        m.recordAdrenaline()
        m.recordAdrenaline()
        m.recordShock()
        m.markROSC()
        let s = m.end()
        XCTAssertEqual(s.adrenalineCount, 2)
        XCTAssertEqual(s.shockCount, 1)
        XCTAssertTrue(s.rosc)
        XCTAssertEqual(s.durationLabel, "10:00")
        XCTAssertEqual(s.cycles, 6)  // 600 / 120 + 1
    }

    func test_timelineAndStats_fromDetector() {
        let mock = MockCompressionDetector()
        let model = CodeBlueModel(detector: mock, workout: NoopWorkoutKeepAlive(), deviceId: "watch")
        model.startCode()
        XCTAssertTrue(mock.isRunning)
        XCTAssertTrue(model.events.contains { $0.kind == .cprStart })

        mock.emit(count: 30, rate: 110, counted: true)
        XCTAssertEqual(model.compressionCount, 30)
        XCTAssertEqual(model.instantaneousRateCPM, 110)
        XCTAssertEqual(model.coachZone, .onTarget)

        model.recordShock()
        model.recordDrug("Epinephrine")
        model.markROSC()
        XCTAssertEqual(model.events.filter { $0.kind == .shock }.count, 1)
        XCTAssertEqual(model.events.filter { $0.kind == .drug }.count, 1)
        XCTAssertTrue(model.rosc)

        let snap = model.snapshot(batteryLevel: 0.5)
        XCTAssertEqual(snap.compressionCount, 30)
        XCTAssertEqual(snap.shockCount, 1)
        XCTAssertTrue(snap.rosc)

        let summary = model.endCode()
        XCTAssertFalse(mock.isRunning)          // detector stopped (battery)
        XCTAssertEqual(summary.totalCompressions, 30)
        XCTAssertEqual(summary.shockCount, 1)
        XCTAssertTrue(summary.rosc)
    }

    func test_reset_wipesEverything() {
        let mock = MockCompressionDetector()
        let model = CodeBlueModel(detector: mock, workout: NoopWorkoutKeepAlive(), deviceId: "watch")
        model.startCode()
        model.tick(200)
        mock.emit(count: 40, rate: 115, counted: true)
        model.recordShock(); model.recordDrug("Epinephrine"); model.markROSC()
        XCTAssertFalse(model.events.isEmpty)

        model.reset()
        XCTAssertEqual(model.events.count, 0)
        XCTAssertEqual(model.compressionCount, 0)
        XCTAssertEqual(model.shockCount, 0)
        XCTAssertEqual(model.adrenalineCount, 0)
        XCTAssertEqual(model.elapsed, 0)
        XCTAssertFalse(model.rosc)
        XCTAssertFalse(model.isRunning)
        XCTAssertFalse(mock.isRunning)
    }

    func test_startCode_startsFreshAfterAPriorCode() {
        let mock = MockCompressionDetector()
        let model = CodeBlueModel(detector: mock, workout: NoopWorkoutKeepAlive(), deviceId: "watch")
        model.startCode(); model.recordShock(); _ = model.endCode()
        XCTAssertEqual(model.events.filter { $0.kind == .shock }.count, 1)
        model.startCode()   // a new code must not carry the prior code's events
        XCTAssertEqual(model.events.filter { $0.kind == .shock }.count, 0)
        XCTAssertEqual(model.events.filter { $0.kind == .cprStart }.count, 1)
    }

    func test_pauseEmitsEvents() {
        let mock = MockCompressionDetector()
        let model = CodeBlueModel(detector: mock, workout: NoopWorkoutKeepAlive(), deviceId: "watch")
        model.startCode()
        mock.emit(count: 10, rate: 110, counted: true)

        var paused = CompressionState(); paused.count = 10; paused.paused = true; paused.pauseSeconds = 3.1
        var pauseTick = AnalyzerTick(); pauseTick.pauseStarted = true
        model.ingestForTest(state: paused, tick: pauseTick)
        XCTAssertTrue(model.paused)
        XCTAssertTrue(model.events.contains { $0.kind == .pauseStart })

        var resumed = CompressionState(); resumed.count = 11; resumed.paused = false
        var resumeTick = AnalyzerTick(); resumeTick.resumed = true
        model.ingestForTest(state: resumed, tick: resumeTick)
        XCTAssertFalse(model.paused)
        XCTAssertTrue(model.events.contains { $0.kind == .resume })
    }
}
