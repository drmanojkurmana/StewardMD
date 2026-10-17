import XCTest
@testable import StewardMDWatchCore

/// Code Blue v2 behaviour: modes, epi schedule, guide, checklist, re-arrest,
/// session resume, editable log and the v2 code sheet payload.
@MainActor
final class CodeBlueV2Tests: XCTestCase {
    private func decode<T: Decodable>(_ t: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(t, from: Data(json.utf8))
    }

    private func model() -> CodeBlueModel {
        let m = CodeBlueModel()
        m.sessionStore = CodeSessionStore(storage: .inMemory())
        return m
    }

    // MARK: backward-compatible decoding of OLD JSON

    func test_oldEventJSONWithoutEditedDecodesAsFalse() throws {
        let old = #"{"id":"watch-drug-1","elapsed":45,"kind":"drug","label":"Epinephrine","sourceDeviceId":"watch"}"#
        let e = try decode(CodeEvent.self, old)
        XCTAssertEqual(e.kind, .drug)
        XCTAssertFalse(e.edited)
    }

    func test_newEventKindsDecode() throws {
        for kind in ["procedure", "reArrest", "note", "modeSet"] {
            let j = #"{"id":"x","elapsed":1,"kind":"\#(kind)","label":"L","sourceDeviceId":"watch","edited":true}"#
            let e = try decode(CodeEvent.self, j)
            XCTAssertEqual(e.kind.rawValue, kind)
            XCTAssertTrue(e.edited)
        }
    }

    func test_oldStateJSONWithoutModeResolvesToAdult() throws {
        let old = #"{"running":true,"elapsed":42,"cycle":1,"compressionCount":0,"instantaneousRateCPM":0,"averageRateCPM":0,"coachZone":"idle","paused":false,"pauseSeconds":0,"adrenalineCount":0,"shockCount":0,"rosc":false,"batteryLevel":0.5,"targetRatePct":0,"events":[],"updatedElapsed":42}"#
        let st = try decode(CodeBlueState.self, old)
        XCTAssertNil(st.mode)
        XCTAssertEqual(st.resolvedMode, .adult)
    }

    // MARK: CodeMode + CodeConfig

    func test_modeConfigs() {
        XCTAssertEqual(CodeMode.adult.config.rhythmCheckInterval, 120)
        XCTAssertEqual(CodeMode.paediatric.config.rhythmCheckInterval, 120)
        XCTAssertEqual(CodeMode.neonatal.config.rhythmCheckInterval, 60)
        XCTAssertEqual(CodeMode.adult.config.compressionVentilationLabel, "30:2 (100 to 120 per min)")
        XCTAssertEqual(CodeMode.paediatric.config.compressionVentilationLabel,
                       "15:2 with two rescuers, 30:2 alone")
        XCTAssertEqual(CodeMode.neonatal.config.compressionVentilationLabel,
                       "3:1 (90 compressions and 30 breaths per min)")
        XCTAssertNotNil(CodeMode.adult.config.advancedAirwayLabel)
        XCTAssertNotNil(CodeMode.paediatric.config.advancedAirwayLabel)
        XCTAssertNil(CodeMode.neonatal.config.advancedAirwayLabel)
    }

    func test_neonatalTimerUsesSixtySecondCycle() {
        let m = model()
        m.startCode(mode: .neonatal)
        XCTAssertEqual(m.mode, .neonatal)
        XCTAssertTrue(m.tick(60))
        XCTAssertEqual(m.cycle, 2)
        XCTAssertTrue(m.events.contains { $0.kind == .modeSet && $0.label.contains("Neonatal") })
    }

    // MARK: EpiSchedule

    func test_epiScheduleBoundaries() {
        XCTAssertEqual(EpiSchedule.status(secondsSinceLastDose: nil), .none)
        XCTAssertEqual(EpiSchedule.status(secondsSinceLastDose: 0), .notDue)
        XCTAssertEqual(EpiSchedule.status(secondsSinceLastDose: 179.9), .notDue)
        XCTAssertEqual(EpiSchedule.status(secondsSinceLastDose: 180), .due)
        XCTAssertEqual(EpiSchedule.status(secondsSinceLastDose: 299.9), .due)
        XCTAssertEqual(EpiSchedule.status(secondsSinceLastDose: 300), .overdue)
        XCTAssertEqual(EpiSchedule.status(secondsSinceLastDose: 900), .overdue)
    }

    func test_modelEpiStatusFollowsLastDose() {
        let m = model()
        m.startCode()
        XCTAssertEqual(m.epiStatus, .none)
        XCTAssertNil(m.secondsToEpiDue)
        m.tick(60)
        m.recordAdrenaline()   // dose at t=60
        XCTAssertEqual(m.epiStatus, .notDue)
        m.tick(120)   // t=180, 120 s since dose
        XCTAssertEqual(m.epiStatus, .notDue)
        m.tick(60)    // t=240, 180 s since dose
        XCTAssertEqual(m.epiStatus, .due)
        XCTAssertEqual(m.secondsToEpiDue, 0)
        m.tick(120)   // t=360, 300 s since dose
        XCTAssertEqual(m.epiStatus, .overdue)
    }

    // MARK: AlgorithmGuide

    func test_guideShockableTrack() {
        var p = AlgorithmGuide.prompts(mode: .adult, lastRhythm: "VF", shockCount: 0,
                                       epinephrineCount: 0, secondsSinceLastEpinephrine: nil,
                                       rosc: false)
        XCTAssertEqual(p.first?.id, "shock")
        XCTAssertEqual(p.first?.urgency, .due)
        XCTAssertFalse(p.contains { $0.id == "epi-indicated" })

        p = AlgorithmGuide.prompts(mode: .adult, lastRhythm: "VT (pulseless)", shockCount: 2,
                                   epinephrineCount: 0, secondsSinceLastEpinephrine: nil,
                                   rosc: false)
        XCTAssertTrue(p.contains { $0.id == "epi-indicated" && $0.urgency == .info })

        p = AlgorithmGuide.prompts(mode: .adult, lastRhythm: "VF", shockCount: 3,
                                   epinephrineCount: 1, secondsSinceLastEpinephrine: 10,
                                   rosc: false)
        XCTAssertTrue(p.contains { $0.id == "antiarrhythmic" })

        p = AlgorithmGuide.prompts(mode: .adult, lastRhythm: "VF", shockCount: 3,
                                   epinephrineCount: 1, secondsSinceLastEpinephrine: 301,
                                   rosc: false)
        XCTAssertEqual(p.first?.id, "epi-overdue")
        XCTAssertEqual(p.first?.urgency, .overdue)
    }

    func test_guideNonShockableTrack() {
        let p = AlgorithmGuide.prompts(mode: .adult, lastRhythm: "PEA", shockCount: 0,
                                       epinephrineCount: 0, secondsSinceLastEpinephrine: nil,
                                       rosc: false)
        XCTAssertEqual(p.first?.id, "epi-indicated")
        XCTAssertTrue(p.first?.text.lowercased().contains("as soon as possible") == true)
    }

    func test_guideBradycardiaTracks() {
        let adult = AlgorithmGuide.prompts(mode: .adult, lastRhythm: "Bradycardia (pulse)",
                                           shockCount: 0, epinephrineCount: 0,
                                           secondsSinceLastEpinephrine: nil, rosc: false)
        XCTAssertTrue(adult.contains { $0.id == "brady-perfusion" })
        XCTAssertFalse(adult.contains { $0.id == "brady-compressions" })
        let paed = AlgorithmGuide.prompts(mode: .paediatric, lastRhythm: "Bradycardia (pulse)",
                                          shockCount: 0, epinephrineCount: 0,
                                          secondsSinceLastEpinephrine: nil, rosc: false)
        XCTAssertTrue(paed.contains { $0.id == "brady-compressions" })
    }

    func test_guideTachycardiaTrack() {
        let p = AlgorithmGuide.prompts(mode: .adult, lastRhythm: "Tachycardia (pulse)",
                                       shockCount: 0, epinephrineCount: 0,
                                       secondsSinceLastEpinephrine: nil, rosc: false)
        XCTAssertTrue(p.contains { $0.text.contains("synchronised cardioversion") })
        XCTAssertTrue(p.contains { $0.text.contains("vagal") })
    }

    func test_guidePostROSCTrack() {
        let p = AlgorithmGuide.prompts(mode: .adult, lastRhythm: "VF", shockCount: 2,
                                       epinephrineCount: 1, secondsSinceLastEpinephrine: 10,
                                       rosc: true)
        XCTAssertEqual(p.first?.id, "post-oxygen")
        let neo = AlgorithmGuide.prompts(mode: .neonatal, lastRhythm: nil, shockCount: 0,
                                         epinephrineCount: 0, secondsSinceLastEpinephrine: nil,
                                         rosc: true)
        XCTAssertTrue(neo.contains { $0.id == "post-parents" })
    }

    func test_guideNeonatalArrestStartsWithVentilation() {
        let p = AlgorithmGuide.prompts(mode: .neonatal, lastRhythm: nil, shockCount: 0,
                                       epinephrineCount: 0, secondsSinceLastEpinephrine: nil,
                                       rosc: false)
        XCTAssertEqual(p.first?.id, "ventilate-first")
    }

    func test_guideStringsHaveNoEmDashAndUseBritishSpelling() {
        var texts: [String] = []
        for mode in CodeMode.allCases {
            for rhythm in [nil, "VF", "VT (pulseless)", "PEA", "Asystole",
                           "Sinus rhythm (pulse)", "Bradycardia (pulse)", "Tachycardia (pulse)"] {
                let ps = AlgorithmGuide.prompts(mode: mode, lastRhythm: rhythm, shockCount: 3,
                                                epinephrineCount: 1, secondsSinceLastEpinephrine: 301,
                                                rosc: false)
                texts += ps.map(\.text) + ps.map(\.source)
                let ros = AlgorithmGuide.prompts(mode: mode, lastRhythm: rhythm, shockCount: 0,
                                                 epinephrineCount: 0, secondsSinceLastEpinephrine: nil,
                                                 rosc: true)
                texts += ros.map(\.text)
            }
            texts += PostROSCChecklist.items(mode: mode).map(\.text)
            texts += [mode.compressionVentilationLabel, mode.displayName]
            texts += [mode.config.advancedAirwayLabel].compactMap { $0 }
        }
        XCTAssertFalse(texts.isEmpty)
        for t in texts {
            XCTAssertFalse(t.contains("—"), "em-dash in: \(t)")
            XCTAssertFalse(t.lowercased().contains("pediatric"), "US spelling in: \(t)")
        }
        XCTAssertTrue(texts.contains { $0.contains("Paediatric") })
    }

    // MARK: Post-ROSC checklist + procedures + notes

    func test_checklistCountsAndTickLogsNote() {
        XCTAssertEqual(PostROSCChecklist.items(mode: .adult).count, 9)
        XCTAssertEqual(PostROSCChecklist.items(mode: .paediatric).count, 9)
        XCTAssertEqual(PostROSCChecklist.items(mode: .neonatal).count, 5)

        let m = model()
        m.startCode()
        let item = PostROSCChecklist.items(mode: .adult)[0]
        let notesBefore = m.events.filter { $0.kind == .note }.count
        m.toggleChecklistItem(item)
        XCTAssertTrue(m.checklistTicks.contains(item.id))
        XCTAssertEqual(m.events.filter { $0.kind == .note }.count, notesBefore + 1)
        m.toggleChecklistItem(item)
        XCTAssertFalse(m.checklistTicks.contains(item.id))
        XCTAssertEqual(m.events.filter { $0.kind == .note }.count, notesBefore + 1)
    }

    func test_procedureAndNoteLogging() {
        let m = model()
        m.startCode()
        m.recordProcedure(.padsOn)
        m.recordNote("Family updated")
        XCTAssertTrue(m.events.contains { $0.kind == .procedure && $0.label == "Pads on" })
        XCTAssertTrue(m.events.contains { $0.kind == .note && $0.label == "Family updated" })
        XCTAssertEqual(CodeProcedure.allCases.count, 7)
    }

    // MARK: re-arrest

    func test_reArrest() {
        let m = model()
        m.startCode(mode: .paediatric)
        m.tick(200)
        m.recordAdrenaline()   // dose at t=200
        m.tick(190)            // t=390, 190 s since dose
        m.markROSC()
        XCTAssertTrue(m.rosc)
        m.reArrest()
        XCTAssertFalse(m.rosc)
        XCTAssertEqual(m.mode, .paediatric)
        XCTAssertTrue(m.events.contains { $0.kind == .reArrest })
        // Epinephrine timer continues from the last dose (190 s ago).
        XCTAssertEqual(m.epiStatus, .due)
    }

    // MARK: editable log

    func test_editDeleteUndoAndRecount() {
        let m = model()
        m.startCode()
        m.tick(30)
        m.recordShock()
        m.recordDrug("Epinephrine")
        m.recordDrug("Amiodarone")
        XCTAssertEqual(m.shockCount, 1)
        XCTAssertEqual(m.adrenalineCount, 1)

        let shockId = m.events.first(where: { $0.kind == .shock })!.id
        let shockElapsed = m.events.first(where: { $0.kind == .shock })!.elapsed
        XCTAssertTrue(m.editEvent(id: shockId, newLabel: "Shock #1 · 200J"))
        let edited = m.events.first(where: { $0.id == shockId })!
        XCTAssertTrue(edited.edited)
        XCTAssertEqual(edited.elapsed, shockElapsed)   // elapsed time kept
        XCTAssertEqual(edited.label, "Shock #1 · 200J")
        XCTAssertFalse(m.editEvent(id: "missing", newLabel: "x"))

        let epiId = m.events.first(where: { $0.kind == .drug && $0.label == "Epinephrine" })!.id
        XCTAssertTrue(m.deleteEvent(id: epiId))
        XCTAssertEqual(m.adrenalineCount, 0)
        XCTAssertFalse(m.events.contains { $0.id == epiId })
        XCTAssertTrue(m.canUndoDelete)
        XCTAssertTrue(m.undoDelete())
        XCTAssertEqual(m.adrenalineCount, 1)
        XCTAssertTrue(m.events.contains { $0.id == epiId })
        XCTAssertFalse(m.canUndoDelete)
        XCTAssertFalse(m.undoDelete())
        XCTAssertFalse(m.deleteEvent(id: "missing"))
    }

    func test_deletingROSCClearsROSC() {
        let m = model()
        m.startCode()
        m.markROSC()
        XCTAssertTrue(m.rosc)
        XCTAssertTrue(m.deleteEvent(id: m.events.first(where: { $0.kind == .rosc })!.id))
        XCTAssertFalse(m.rosc)
    }

    // MARK: session snapshot + resume

    func test_sessionSaveRestoreAndStaleness() {
        let store = CodeSessionStore(storage: .inMemory())
        let t0 = Date(timeIntervalSince1970: 1_000_000)
        let m1 = model()
        m1.sessionStore = store
        m1.clock = { t0 }
        m1.startCode(mode: .paediatric)
        m1.tick(100)
        m1.recordShock()

        let t1 = t0.addingTimeInterval(60)
        let m2 = model()
        m2.sessionStore = store
        m2.clock = { t1 }   // re-save lands at t1 so the stale bound is deterministic
        XCTAssertTrue(m2.hasResumableSession(now: t1))
        XCTAssertTrue(m2.restoreSession(now: t1))
        XCTAssertTrue(m2.isRunning)
        XCTAssertEqual(m2.mode, .paediatric)
        XCTAssertEqual(m2.elapsed, 160, accuracy: 0.001)  // 100 saved + 60 wall clock
        XCTAssertEqual(m2.shockCount, 1)

        // Older than 6 h: discarded.
        let m3 = model()
        m3.sessionStore = store
        XCTAssertFalse(m3.restoreSession(now: t1.addingTimeInterval(6 * 3600 + 1)))
        XCTAssertFalse(m3.hasResumableSession(now: t1.addingTimeInterval(6 * 3600 + 2)))
    }

    func test_sessionStoreStalenessBoundary() {
        let t0 = Date(timeIntervalSince1970: 2_000_000)
        let store = CodeSessionStore(now: { t0 }, storage: .inMemory())
        let snap = CodeSessionSnapshot(mode: .adult, startedAtWallClock: t0,
                                       elapsedAtSave: 100, events: [],
                                       adrenalineCount: 0, shockCount: 0, rosc: false,
                                       checklistTicks: [], savedAtWallClock: t0)
        store.save(snap)
        XCTAssertEqual(store.restore(now: t0.addingTimeInterval(6 * 3600))?.resumedElapsed, 100 + 6 * 3600)
        XCTAssertNil(store.restore(now: t0.addingTimeInterval(6 * 3600 + 1)))
        XCTAssertNil(store.peek())  // stale snapshot discarded
    }

    func test_endCodeClearsSession() {
        let m1 = model()
        let store = m1.sessionStore
        m1.startCode()
        m1.recordShock()
        _ = m1.endCode()
        let m2 = model()
        m2.sessionStore = store
        XCTAssertFalse(m2.hasResumableSession())
    }

    // MARK: v2 code sheet payload

    func test_codeSheetPayloadV2() throws {
        let m = model()
        m.startCode(mode: .adult)
        m.tick(210)
        m.recordShock(energyJ: 200)
        m.recordDrug("Epinephrine")
        m.markROSC()
        let startedAt = Date(timeIntervalSince1970: 3_000_000)
        let data = try CodeSheet.jsonData(summary: CodeSummary.build(events: m.events, durationSeconds: 210,
                                                                    cycles: m.cycle, totalCompressions: 300,
                                                                    averageRateCPM: 110, targetRatePct: 80),
                                          events: m.events, mode: .adult, startedAt: startedAt,
                                          durationSeconds: 210, cycles: m.cycle)
        let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        XCTAssertEqual(json["v"] as! Int, 2)
        XCTAssertEqual(json["mode"] as! String, "adult")
        XCTAssertEqual(json["durationSeconds"] as! Int, 210)
        XCTAssertEqual((json["startedAt"] as! String).prefix(4), "2026")
        let events = json["events"] as! [[String: Any]]
        XCTAssertTrue(events.allSatisfy { $0["edited"] != nil && $0["id"] != nil })
        let summary = json["summary"] as! [String: Any]
        for key in ["compressions", "averageRateCPM", "compressionFractionPct",
                    "targetRatePct", "shockCount", "adrenalineCount", "rosc"] {
            XCTAssertNotNil(summary[key], "missing summary key \(key)")
        }
        XCTAssertEqual(summary["shockCount"] as! Int, 1)
        XCTAssertEqual(summary["adrenalineCount"] as! Int, 1)
        XCTAssertNotNil(json["disclaimer"])
    }

    func test_codeSheetPlainTextFallback() {
        let m = model()
        m.startCode(mode: .neonatal)
        m.recordRhythm("VF")
        let summary = CodeSummary.build(events: m.events, durationSeconds: 60, cycles: 1,
                                        totalCompressions: 90, averageRateCPM: 120)
        let text = CodeSheet.plainText(summary: summary, events: m.events, mode: .neonatal,
                                       startedAt: Date(timeIntervalSince1970: 3_000_000))
        XCTAssertTrue(text.contains("CODE BLUE RECORD"))
        XCTAssertTrue(text.contains("Neonatal"))
        XCTAssertTrue(text.contains("Rhythm — VF"))
    }

    func test_snapshotCarriesMode() {
        let m = model()
        m.startCode(mode: .neonatal)
        XCTAssertEqual(m.snapshot(batteryLevel: 0.5).resolvedMode, .neonatal)
    }
}
