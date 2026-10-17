import XCTest
@testable import StewardMDWatchCore

/// Cue engine boundaries, mute independence and safe output. Phrases match
/// DESIGN.md section 5 exactly. No doses in any cue text.
final class CueEngineTests: XCTestCase {
    private let allOn = CueSettings(voice: true, metronome: true, breaths: true)
    private let voiceOnly = CueSettings(voice: true, metronome: false, breaths: false)

    private func voiceTexts(_ cues: [Cue]) -> [String] {
        cues.filter { $0.kind == .voice }.compactMap(\.text)
    }

    // MARK: - Rhythm check boundaries

    func test_rhythmWarningFiresTenSecondsBeforeAdultCheck() {
        let cues = CueEngine.cuesDue(mode: .adult, from: 109, to: 110, settings: voiceOnly)
        XCTAssertEqual(voiceTexts(cues), ["Rhythm check in ten seconds"])
        XCTAssertEqual(cues.first?.atElapsed, 110)
    }

    func test_noRhythmWarningBeforeTheWindow() {
        let cues = CueEngine.cuesDue(mode: .adult, from: 100, to: 109.9, settings: voiceOnly)
        XCTAssertTrue(voiceTexts(cues).isEmpty)
    }

    func test_rhythmCheckFiresAtTheBoundaryWithExactPhrase() {
        let cues = CueEngine.cuesDue(mode: .adult, from: 119, to: 120, settings: voiceOnly)
        XCTAssertEqual(voiceTexts(cues), ["Rhythm check. Switch compressor"])
        XCTAssertEqual(cues.first?.atElapsed, 120)
    }

    func test_rhythmCheckDoesNotFireEarly() {
        let cues = CueEngine.cuesDue(mode: .adult, from: 100, to: 119.9, settings: voiceOnly)
        XCTAssertFalse(voiceTexts(cues).contains("Rhythm check. Switch compressor"))
    }

    func test_secondCycleWarningAndCheck() {
        let warn = CueEngine.cuesDue(mode: .adult, from: 229, to: 230, settings: voiceOnly)
        XCTAssertEqual(voiceTexts(warn), ["Rhythm check in ten seconds"])
        let check = CueEngine.cuesDue(mode: .adult, from: 239, to: 240, settings: voiceOnly)
        XCTAssertEqual(voiceTexts(check), ["Rhythm check. Switch compressor"])
    }

    func test_paediatricSharesTheAdultInterval() {
        let cues = CueEngine.cuesDue(mode: .paediatric, from: 119, to: 120, settings: voiceOnly)
        XCTAssertEqual(voiceTexts(cues), ["Rhythm check. Switch compressor"])
    }

    func test_neonatalHeartRateCheckAtSixtySeconds() {
        let warn = CueEngine.cuesDue(mode: .neonatal, from: 49, to: 50,
                                     settings: CueSettings(voice: true, metronome: false, breaths: false))
        XCTAssertEqual(voiceTexts(warn), ["Rhythm check in ten seconds"])
        let check = CueEngine.cuesDue(mode: .neonatal, from: 59, to: 60,
                                      settings: CueSettings(voice: true, metronome: false, breaths: false))
        XCTAssertEqual(voiceTexts(check), ["Rhythm check. Switch compressor"])
    }

    // MARK: - Epinephrine due and overdue, once each

    func test_epinephrineDueFiresOnceAtThreeMinutes() {
        let cues = CueEngine.cuesDue(mode: .adult, from: 179, to: 180,
                                     lastEpinephrineAt: 0, settings: voiceOnly)
        XCTAssertEqual(voiceTexts(cues), ["Epinephrine due"])
    }

    func test_epinephrineDueDoesNotRepeatInLaterWindows() {
        let cues = CueEngine.cuesDue(mode: .adult, from: 181, to: 200,
                                     lastEpinephrineAt: 0, settings: voiceOnly)
        XCTAssertTrue(voiceTexts(cues).isEmpty)
    }

    func test_epinephrineOverdueFiresOnceAtFiveMinutes() {
        let cues = CueEngine.cuesDue(mode: .adult, from: 299, to: 300,
                                     lastEpinephrineAt: 0, settings: voiceOnly)
        XCTAssertEqual(voiceTexts(cues), ["Epinephrine overdue"])
    }

    func test_wideWindowEmitsDueAndOverdueExactlyOnceEach() {
        let cues = CueEngine.cuesDue(mode: .adult, from: 0, to: 1000,
                                     lastEpinephrineAt: 0, settings: voiceOnly)
        let texts = voiceTexts(cues)
        XCTAssertEqual(texts.filter { $0 == "Epinephrine due" }.count, 1)
        XCTAssertEqual(texts.filter { $0 == "Epinephrine overdue" }.count, 1)
    }

    func test_noEpinephrineCueBeforeTheFirstDose() {
        let cues = CueEngine.cuesDue(mode: .adult, from: 0, to: 1000,
                                     lastEpinephrineAt: nil, settings: voiceOnly)
        XCTAssertFalse(voiceTexts(cues).contains("Epinephrine due"))
        XCTAssertFalse(voiceTexts(cues).contains("Epinephrine overdue"))
    }

    func test_epinephrineTimerAnchorsOnTheLastDose() {
        let cues = CueEngine.cuesDue(mode: .adult, from: 279, to: 280,
                                     lastEpinephrineAt: 100, settings: voiceOnly)
        XCTAssertEqual(voiceTexts(cues), ["Epinephrine due"])
    }

    // MARK: - Metronome

    func test_metronomeTicks110PerMinute() {
        let cues = CueEngine.cuesDue(mode: .adult, from: 0, to: 60,
                                     settings: CueSettings(voice: false, metronome: true, breaths: false))
        XCTAssertEqual(cues.count, 110)
        XCTAssertTrue(cues.allSatisfy { $0.kind == .metronome && $0.text == nil })
        let gaps = zip(cues, cues.dropFirst()).map { $1.atElapsed - $0.atElapsed }
        XCTAssertTrue(gaps.allSatisfy { abs($0 - 60.0 / 110.0) < 1e-9 })
    }

    func test_metronomeMutedIndependently() {
        let cues = CueEngine.cuesDue(mode: .adult, from: 0, to: 60,
                                     settings: CueSettings(voice: true, metronome: false, breaths: true))
        XCTAssertTrue(cues.allSatisfy { $0.kind != .metronome })
        XCTAssertFalse(cues.isEmpty)
    }

    // MARK: - Breaths

    func test_advancedAirwayBreathEverySixSeconds() {
        let cues = CueEngine.cuesDue(mode: .adult, from: 0, to: 18, advancedAirway: true,
                                     settings: CueSettings(voice: false, metronome: false, breaths: true))
        XCTAssertEqual(cues.map(\.atElapsed), [6, 12, 18])
        XCTAssertTrue(cues.allSatisfy { $0.kind == .breath && $0.text == "Give breath" })
    }

    func test_twoBreathsOncePerAdultCompressionSet() {
        let period = 30 * 60.0 / 110.0
        let cues = CueEngine.cuesDue(mode: .adult, from: 0, to: period,
                                     settings: CueSettings(voice: false, metronome: false, breaths: true))
        XCTAssertEqual(cues.count, 1)
        XCTAssertEqual(cues.first?.text, "Two breaths")
        XCTAssertEqual(cues.first?.atElapsed ?? -1, period, accuracy: 1e-9)
    }

    func test_twoBreathsOncePerPaediatricCompressionSet() {
        let period = 15 * 60.0 / 110.0
        let cues = CueEngine.cuesDue(mode: .paediatric, from: 0, to: period,
                                     settings: CueSettings(voice: false, metronome: false, breaths: true))
        XCTAssertEqual(cues.count, 1)
        XCTAssertEqual(cues.first?.text, "Two breaths")
    }

    func test_advancedAirwayReplacesTwoBreaths() {
        let cues = CueEngine.cuesDue(mode: .adult, from: 0, to: 30, advancedAirway: true,
                                     settings: CueSettings(voice: false, metronome: false, breaths: true))
        XCTAssertFalse(cues.map(\.text).contains("Two breaths"))
        XCTAssertTrue(cues.map(\.text).contains("Give breath"))
    }

    func test_breathsMutedIndependently() {
        let cues = CueEngine.cuesDue(mode: .adult, from: 0, to: 60, advancedAirway: true,
                                     settings: CueSettings(voice: true, metronome: true, breaths: false))
        XCTAssertTrue(cues.allSatisfy { $0.kind != .breath })
        XCTAssertFalse(cues.isEmpty)
    }

    func test_voiceMutedIndependently() {
        let cues = CueEngine.cuesDue(mode: .adult, from: 109, to: 120,
                                     lastEpinephrineAt: 0, settings: CueSettings(voice: false, metronome: true, breaths: true))
        XCTAssertTrue(cues.filter { $0.kind == .voice }.isEmpty)
        XCTAssertFalse(cues.isEmpty)
    }

    // MARK: - Neonatal cadence

    func test_neonatalThreeToOneCadence() {
        let cues = CueEngine.cuesDue(mode: .neonatal, from: 0, to: 2,
                                     settings: CueSettings(voice: false, metronome: false, breaths: true))
        XCTAssertEqual(cues.map(\.atElapsed), [0.5, 1.0, 1.5, 2.0])
        XCTAssertEqual(cues.compactMap(\.text), ["One", "Two", "Three", "Give breath"])
        XCTAssertTrue(cues.allSatisfy { $0.kind == .breath })
    }

    func test_neonatalIgnoresAdvancedAirway() {
        let cues = CueEngine.cuesDue(mode: .neonatal, from: 0, to: 6, advancedAirway: true,
                                     settings: CueSettings(voice: false, metronome: false, breaths: true))
        XCTAssertEqual(cues.count, 12)
        XCTAssertFalse(cues.map(\.text).contains("Two breaths"))
    }

    // MARK: - Paused and ROSC silence

    func test_noCueWhilePaused() {
        let cues = CueEngine.cuesDue(mode: .adult, from: 119, to: 121, paused: true, settings: allOn)
        XCTAssertTrue(cues.isEmpty)
    }

    func test_noCueAfterROSC() {
        let cues = CueEngine.cuesDue(mode: .adult, from: 0, to: 400,
                                     lastEpinephrineAt: 0, rosc: true, settings: allOn)
        XCTAssertTrue(cues.isEmpty)
    }

    func test_emptyWindowEmitsNothing() {
        XCTAssertTrue(CueEngine.cuesDue(mode: .adult, from: 10, to: 10, settings: allOn).isEmpty)
        XCTAssertTrue(CueEngine.cuesDue(mode: .adult, from: 20, to: 10, settings: allOn).isEmpty)
    }

    // MARK: - Safe output: never a dose

    func test_noCueTextContainsADose() {
        let pattern = try! NSRegularExpression(pattern: #"\d\s*(mg|mcg|mL|J)"#)
        for mode in CodeMode.allCases {
            for airway in [false, true] {
                let cues = CueEngine.cuesDue(mode: mode, from: 0, to: 1200,
                                             lastEpinephrineAt: 0, advancedAirway: airway,
                                             settings: allOn)
                XCTAssertFalse(cues.isEmpty, "\(mode) airway=\(airway) should emit cues")
                for cue in cues {
                    guard let text = cue.text else { continue }
                    let range = NSRange(text.startIndex..., in: text)
                    XCTAssertNil(pattern.firstMatch(in: text, range: range),
                                 "cue text carries a dose: \(text)")
                }
            }
        }
    }

    // MARK: - Announcer

    func test_announcerSpeaksTextAndFallsBackToHaptic() {
        let stub = StubSpeech(canSpeak: true)
        var haptics: [CueKind] = []
        let cues = [
            Cue(kind: .voice, text: "Epinephrine due", atElapsed: 180),
            Cue(kind: .metronome, atElapsed: 180.5),
        ]
        CueAnnouncer.announce(cues, speech: stub, haptic: { haptics.append($0) })
        XCTAssertEqual(stub.spoken, ["Epinephrine due"])
        XCTAssertEqual(haptics, [.metronome])
    }

    func test_announcerUsesHapticWhenSpeechUnavailable() {
        let stub = StubSpeech(canSpeak: false)
        var haptics: [CueKind] = []
        CueAnnouncer.announce([Cue(kind: .voice, text: "Epinephrine due", atElapsed: 180)],
                              speech: stub, haptic: { haptics.append($0) })
        XCTAssertTrue(stub.spoken.isEmpty)
        XCTAssertEqual(haptics, [.voice])
    }
}

private final class StubSpeech: SpeechOutput {
    let canSpeak: Bool
    var spoken: [String] = []
    init(canSpeak: Bool) { self.canSpeak = canSpeak }
    func speak(_ text: String) { spoken.append(text) }
}
