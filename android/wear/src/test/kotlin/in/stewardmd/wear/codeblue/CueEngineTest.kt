package `in`.stewardmd.wear.codeblue

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

/**
 * Cue engine boundaries, mute independence and safe output. Phrases match DESIGN.md section 5
 * exactly and behaviour matches the Swift CueEngine. No doses in any cue text.
 */
class CueEngineTest {

    private val allOn = CueSettings(voice = true, metronome = true, breaths = true)
    private val voiceOnly = CueSettings(voice = true, metronome = false, breaths = false)
    private val noVoice = CueSettings(voice = false, metronome = true, breaths = true)
    private val breathOnly = CueSettings(voice = false, metronome = false, breaths = true)
    private val tickless = CueSettings(voice = true, metronome = false, breaths = false)

    private fun voiceTexts(cues: List<Cue>): List<String> =
        cues.filter { it.kind == CueKind.Voice }.mapNotNull { it.text }

    // MARK: - Rhythm check boundaries

    @Test fun rhythmWarningFiresTenSecondsBeforeAdultCheck() {
        val cues = CueEngine.cuesDue(CodeMode.Adult, 109.0, 110.0, settings = voiceOnly)
        assertEquals(listOf("Rhythm check in ten seconds"), voiceTexts(cues))
        assertEquals(110.0, cues.single().atElapsedSeconds, 0.0)
    }

    @Test fun noRhythmWarningBeforeTheWindow() {
        val cues = CueEngine.cuesDue(CodeMode.Adult, 100.0, 109.9, settings = voiceOnly)
        assertTrue(voiceTexts(cues).isEmpty())
    }

    @Test fun rhythmCheckFiresAtTheBoundaryWithExactPhrase() {
        val cues = CueEngine.cuesDue(CodeMode.Adult, 119.0, 120.0, settings = voiceOnly)
        assertEquals(listOf("Rhythm check. Switch compressor"), voiceTexts(cues))
        assertEquals(120.0, cues.single().atElapsedSeconds, 0.0)
    }

    @Test fun rhythmCheckDoesNotFireEarly() {
        val cues = CueEngine.cuesDue(CodeMode.Adult, 100.0, 119.9, settings = voiceOnly)
        assertTrue(!voiceTexts(cues).contains("Rhythm check. Switch compressor"))
    }

    @Test fun secondCycleWarningAndCheck() {
        val warn = CueEngine.cuesDue(CodeMode.Adult, 229.0, 230.0, settings = voiceOnly)
        assertEquals(listOf("Rhythm check in ten seconds"), voiceTexts(warn))
        val check = CueEngine.cuesDue(CodeMode.Adult, 239.0, 240.0, settings = voiceOnly)
        assertEquals(listOf("Rhythm check. Switch compressor"), voiceTexts(check))
    }

    @Test fun paediatricSharesTheAdultInterval() {
        val cues = CueEngine.cuesDue(CodeMode.Paediatric, 119.0, 120.0, settings = voiceOnly)
        assertEquals(listOf("Rhythm check. Switch compressor"), voiceTexts(cues))
    }

    @Test fun neonatalHeartRateCheckAtSixtySeconds() {
        val warn = CueEngine.cuesDue(CodeMode.Neonatal, 49.0, 50.0, settings = tickless)
        assertEquals(listOf("Rhythm check in ten seconds"), voiceTexts(warn))
        val check = CueEngine.cuesDue(CodeMode.Neonatal, 59.0, 60.0, settings = tickless)
        assertEquals(listOf("Rhythm check. Switch compressor"), voiceTexts(check))
    }

    // MARK: - Epinephrine due and overdue, once each

    @Test fun epinephrineDueFiresOnceAtThreeMinutes() {
        val cues = CueEngine.cuesDue(CodeMode.Adult, 179.0, 180.0, lastEpinephrineAt = 0.0, settings = voiceOnly)
        assertEquals(listOf("Epinephrine due"), voiceTexts(cues))
    }

    @Test fun epinephrineDueDoesNotRepeatInLaterWindows() {
        val cues = CueEngine.cuesDue(CodeMode.Adult, 181.0, 200.0, lastEpinephrineAt = 0.0, settings = voiceOnly)
        assertTrue(voiceTexts(cues).isEmpty())
    }

    @Test fun epinephrineOverdueFiresOnceAtFiveMinutes() {
        val cues = CueEngine.cuesDue(CodeMode.Adult, 299.0, 300.0, lastEpinephrineAt = 0.0, settings = voiceOnly)
        assertEquals(listOf("Epinephrine overdue"), voiceTexts(cues))
    }

    @Test fun wideWindowEmitsDueAndOverdueExactlyOnceEach() {
        val cues = CueEngine.cuesDue(CodeMode.Adult, 0.0, 1000.0, lastEpinephrineAt = 0.0, settings = voiceOnly)
        val texts = voiceTexts(cues)
        assertEquals(1, texts.count { it == "Epinephrine due" })
        assertEquals(1, texts.count { it == "Epinephrine overdue" })
    }

    @Test fun noEpinephrineCueBeforeTheFirstDose() {
        val cues = CueEngine.cuesDue(CodeMode.Adult, 0.0, 1000.0, lastEpinephrineAt = null, settings = voiceOnly)
        assertTrue(!voiceTexts(cues).contains("Epinephrine due"))
        assertTrue(!voiceTexts(cues).contains("Epinephrine overdue"))
    }

    @Test fun epinephrineTimerAnchorsOnTheLastDose() {
        val cues = CueEngine.cuesDue(CodeMode.Adult, 279.0, 280.0, lastEpinephrineAt = 100.0, settings = voiceOnly)
        assertEquals(listOf("Epinephrine due"), voiceTexts(cues))
    }

    // MARK: - Metronome

    @Test fun metronomeTicks110PerMinute() {
        val cues = CueEngine.cuesDue(
            CodeMode.Adult, 0.0, 60.0,
            settings = CueSettings(voice = false, metronome = true, breaths = false),
        )
        assertEquals(110, cues.size)
        assertTrue(cues.all { it.kind == CueKind.Metronome && it.text == null })
        cues.zipWithNext { a, b ->
            assertTrue(abs((b.atElapsedSeconds - a.atElapsedSeconds) - 60.0 / 110.0) < 1e-9)
        }
    }

    @Test fun metronomeMutedIndependently() {
        val cues = CueEngine.cuesDue(
            CodeMode.Adult, 0.0, 60.0,
            settings = CueSettings(voice = true, metronome = false, breaths = true),
        )
        assertTrue(cues.all { it.kind != CueKind.Metronome })
        assertTrue(cues.isNotEmpty())
    }

    // MARK: - Breaths

    @Test fun advancedAirwayBreathEverySixSeconds() {
        val cues = CueEngine.cuesDue(
            CodeMode.Adult, 0.0, 18.0, advancedAirway = true, settings = breathOnly,
        )
        assertEquals(listOf(6.0, 12.0, 18.0), cues.map { it.atElapsedSeconds })
        assertTrue(cues.all { it.kind == CueKind.Breath && it.text == "Give breath" })
    }

    @Test fun twoBreathsOncePerAdultCompressionSet() {
        val period = 30 * 60.0 / 110.0
        val cues = CueEngine.cuesDue(CodeMode.Adult, 0.0, period, settings = breathOnly)
        assertEquals(1, cues.size)
        assertEquals("Two breaths", cues.single().text)
        assertEquals(period, cues.single().atElapsedSeconds, 1e-9)
    }

    @Test fun twoBreathsOncePerPaediatricCompressionSet() {
        val period = 15 * 60.0 / 110.0
        val cues = CueEngine.cuesDue(CodeMode.Paediatric, 0.0, period, settings = breathOnly)
        assertEquals(1, cues.size)
        assertEquals("Two breaths", cues.single().text)
    }

    @Test fun advancedAirwayReplacesTwoBreaths() {
        val cues = CueEngine.cuesDue(
            CodeMode.Adult, 0.0, 30.0, advancedAirway = true, settings = breathOnly,
        )
        assertTrue(!cues.map { it.text }.contains("Two breaths"))
        assertTrue(cues.map { it.text }.contains("Give breath"))
    }

    @Test fun breathsMutedIndependently() {
        val cues = CueEngine.cuesDue(
            CodeMode.Adult, 0.0, 60.0, advancedAirway = true,
            settings = CueSettings(voice = true, metronome = true, breaths = false),
        )
        assertTrue(cues.all { it.kind != CueKind.Breath })
        assertTrue(cues.isNotEmpty())
    }

    @Test fun voiceMutedIndependently() {
        val cues = CueEngine.cuesDue(
            CodeMode.Adult, 109.0, 120.0, lastEpinephrineAt = 0.0, settings = noVoice,
        )
        assertTrue(cues.filter { it.kind == CueKind.Voice }.isEmpty())
        assertTrue(cues.isNotEmpty())
    }

    // MARK: - Neonatal cadence

    @Test fun neonatalThreeToOneCadence() {
        val cues = CueEngine.cuesDue(CodeMode.Neonatal, 0.0, 2.0, settings = breathOnly)
        assertEquals(listOf(0.5, 1.0, 1.5, 2.0), cues.map { it.atElapsedSeconds })
        assertEquals(listOf("One", "Two", "Three", "Give breath"), cues.map { it.text })
        assertTrue(cues.all { it.kind == CueKind.Breath })
    }

    @Test fun neonatalIgnoresAdvancedAirway() {
        val cues = CueEngine.cuesDue(
            CodeMode.Neonatal, 0.0, 6.0, advancedAirway = true, settings = breathOnly,
        )
        assertEquals(12, cues.size)
        assertTrue(!cues.map { it.text }.contains("Two breaths"))
    }

    // MARK: - Paused and ROSC silence

    @Test fun noCueWhilePaused() {
        val cues = CueEngine.cuesDue(CodeMode.Adult, 119.0, 121.0, paused = true, settings = allOn)
        assertTrue(cues.isEmpty())
    }

    @Test fun noCueAfterRosc() {
        val cues = CueEngine.cuesDue(
            CodeMode.Adult, 0.0, 400.0, lastEpinephrineAt = 0.0, rosc = true, settings = allOn,
        )
        assertTrue(cues.isEmpty())
    }

    @Test fun emptyWindowEmitsNothing() {
        assertTrue(CueEngine.cuesDue(CodeMode.Adult, 10.0, 10.0, settings = allOn).isEmpty())
        assertTrue(CueEngine.cuesDue(CodeMode.Adult, 20.0, 10.0, settings = allOn).isEmpty())
    }

    // MARK: - Safe output: never a dose

    @Test fun noCueTextContainsADose() {
        val dose = Regex("""\d\s*(mg|mcg|mL|J)""")
        for (mode in CodeMode.entries) {
            for (airway in listOf(false, true)) {
                val cues = CueEngine.cuesDue(
                    mode, 0.0, 1200.0, lastEpinephrineAt = 0.0,
                    advancedAirway = airway, settings = allOn,
                )
                assertTrue("$mode airway=$airway should emit cues", cues.isNotEmpty())
                for (cue in cues) {
                    val text = cue.text ?: continue
                    assertTrue("cue text carries a dose: $text", !dose.containsMatchIn(text))
                }
            }
        }
    }

    // MARK: - Announcer

    @Test fun announcerSpeaksTextAndFallsBackToHaptic() {
        val stub = StubSpeech(canSpeak = true)
        val haptics = mutableListOf<CueKind>()
        val cues = listOf(
            Cue(CueKind.Voice, "Epinephrine due", 180.0),
            Cue(CueKind.Metronome, null, 180.5),
        )
        CueAnnouncer.announce(cues, stub) { haptics += it }
        assertEquals(listOf("Epinephrine due"), stub.spoken)
        assertEquals(listOf(CueKind.Metronome), haptics)
    }

    @Test fun announcerUsesHapticWhenSpeechUnavailable() {
        val stub = StubSpeech(canSpeak = false)
        val haptics = mutableListOf<CueKind>()
        CueAnnouncer.announce(listOf(Cue(CueKind.Voice, "Epinephrine due", 180.0)), stub) { haptics += it }
        assertTrue(stub.spoken.isEmpty())
        assertEquals(listOf(CueKind.Voice), haptics)
    }

    private class StubSpeech(override val canSpeak: Boolean) : SpeechOutput {
        val spoken = mutableListOf<String>()
        override fun speak(text: String) {
            spoken += text
        }
    }
}
