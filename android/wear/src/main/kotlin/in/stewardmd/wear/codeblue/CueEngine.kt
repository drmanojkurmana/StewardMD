package `in`.stewardmd.wear.codeblue

import kotlin.math.floor

/**
 * Audio cue vocabulary for a code (DESIGN.md section 5). Pure and stateless, behaviour matches
 * the Swift CueEngine: given the mode, the elapsed window, the last epinephrine time, the
 * advanced airway flag, paused/ROSC state and the mute settings, it returns the cues due inside
 * the window as values. The caller speaks them (see [SpeechOutput]) and advances its own cursor,
 * so each boundary fires once. No doses, ever.
 */
enum class CueKind {
    /** Spoken phrase. Gated by [CueSettings.voice]. */
    Voice,

    /** 110 per minute tick. Gated by [CueSettings.metronome]. */
    Metronome,

    /** Breath pacing cue. Gated by [CueSettings.breaths]. */
    Breath,
}

/** One cue due at a moment in the code. [text] is null for bare ticks. */
data class Cue(
    val kind: CueKind,
    val text: String?,
    val atElapsedSeconds: Double,
)

/** Independent mute classes (DESIGN.md section 5): voice, metronome, breaths. */
data class CueSettings(
    val voice: Boolean = true,
    val metronome: Boolean = true,
    val breaths: Boolean = true,
)

object CueEngine {
    /** Spoken ten second warning before each rhythm check. */
    const val RHYTHM_WARNING_TEXT = "Rhythm check in ten seconds"

    /** Spoken at each rhythm check boundary. */
    const val RHYTHM_CHECK_TEXT = "Rhythm check. Switch compressor"

    /** Spoken once when epinephrine becomes due. */
    const val EPINEPHRINE_DUE_TEXT = "Epinephrine due"

    /** Spoken once when epinephrine becomes overdue. */
    const val EPINEPHRINE_OVERDUE_TEXT = "Epinephrine overdue"

    /** Spoken breath cue with an advanced airway in place. */
    const val GIVE_BREATH_TEXT = "Give breath"

    /** Spoken once per compression set without an advanced airway (30:2, 15:2). */
    const val TWO_BREATHS_TEXT = "Two breaths"

    /** Neonatal 3:1 count words, repeating. The fourth step reuses Give breath. */
    val NEONATAL_COUNT_WORDS = listOf("One", "Two", "Three", GIVE_BREATH_TEXT)

    /** Metronome rate: 110 ticks per minute. */
    val METRONOME_INTERVAL = 60.0 / 110.0

    /** Breath tick with an advanced airway: one breath every 6 s. */
    const val ADVANCED_AIRWAY_BREATH_INTERVAL = 6.0

    /** Rhythm check warning lead time. */
    const val RHYTHM_WARNING_LEAD = 10.0

    /**
     * Neonatal 3:1 cadence: 90 compressions plus 30 breaths per minute,
     * which is 120 events per minute.
     */
    const val NEONATAL_CADENCE_INTERVAL = 0.5

    /**
     * Time for one compression set at the metronome rate, used for the spoken "Two breaths"
     * cue without an advanced airway. Adult 30:2 uses 30 compressions; paediatric uses 15:2
     * with two rescuers. Null for neonatal, which uses the 3:1 cadence instead.
     */
    fun compressionSetInterval(mode: CodeMode): Double? = when (mode) {
        CodeMode.Adult -> 30 * METRONOME_INTERVAL
        CodeMode.Paediatric -> 15 * METRONOME_INTERVAL
        CodeMode.Neonatal -> null
    }

    /**
     * Cues due in the half open window (previousElapsed, elapsed]. Empty when paused, after
     * ROSC, or when the window is empty. Sorted by time, then kind.
     */
    fun cuesDue(
        mode: CodeMode,
        previousElapsed: Double,
        elapsed: Double,
        lastEpinephrineAt: Double? = null,
        advancedAirway: Boolean = false,
        paused: Boolean = false,
        rosc: Boolean = false,
        settings: CueSettings = CueSettings(),
    ): List<Cue> {
        if (paused || rosc || elapsed <= previousElapsed) return emptyList()
        val cues = mutableListOf<Cue>()
        if (settings.voice) cues += voiceCues(mode, previousElapsed, elapsed, lastEpinephrineAt)
        if (settings.metronome) {
            var k = floor(previousElapsed / METRONOME_INTERVAL).toInt() + 1
            while (k * METRONOME_INTERVAL <= elapsed) {
                val at = k * METRONOME_INTERVAL
                if (at > 0) cues += Cue(CueKind.Metronome, null, at)
                k++
            }
        }
        if (settings.breaths) cues += breathCues(mode, previousElapsed, elapsed, advancedAirway)
        return cues.sortedWith(compareBy({ it.atElapsedSeconds }, { sortKey(it.kind) }))
    }

    private fun voiceCues(
        mode: CodeMode,
        previousElapsed: Double,
        elapsed: Double,
        lastEpinephrineAt: Double?,
    ): List<Cue> {
        val cues = mutableListOf<Cue>()
        val interval = mode.rhythmCheckSeconds.toDouble()
        if (interval > RHYTHM_WARNING_LEAD) {
            var cycle = floor(previousElapsed / interval).toInt() + 1
            while (cycle * interval - RHYTHM_WARNING_LEAD <= elapsed) {
                val warnAt = cycle * interval - RHYTHM_WARNING_LEAD
                if (warnAt > previousElapsed && warnAt > 0) {
                    cues += Cue(CueKind.Voice, RHYTHM_WARNING_TEXT, warnAt)
                }
                cycle++
            }
            var check = floor(previousElapsed / interval).toInt() + 1
            while (check * interval <= elapsed) {
                val at = check * interval
                if (at > 0) cues += Cue(CueKind.Voice, RHYTHM_CHECK_TEXT, at)
                check++
            }
        }
        if (lastEpinephrineAt != null) {
            val dueAt = lastEpinephrineAt + EPI_DUE_SECONDS
            if (dueAt > previousElapsed && dueAt <= elapsed) {
                cues += Cue(CueKind.Voice, EPINEPHRINE_DUE_TEXT, dueAt)
            }
            val overdueAt = lastEpinephrineAt + EPI_OVERDUE_SECONDS
            if (overdueAt > previousElapsed && overdueAt <= elapsed) {
                cues += Cue(CueKind.Voice, EPINEPHRINE_OVERDUE_TEXT, overdueAt)
            }
        }
        return cues
    }

    private fun breathCues(
        mode: CodeMode,
        previousElapsed: Double,
        elapsed: Double,
        advancedAirway: Boolean,
    ): List<Cue> {
        if (mode == CodeMode.Neonatal) {
            val cues = mutableListOf<Cue>()
            var k = floor(previousElapsed / NEONATAL_CADENCE_INTERVAL).toInt() + 1
            while (k * NEONATAL_CADENCE_INTERVAL <= elapsed) {
                val at = k * NEONATAL_CADENCE_INTERVAL
                if (at > 0) {
                    cues += Cue(CueKind.Breath, NEONATAL_COUNT_WORDS[(k - 1) % NEONATAL_COUNT_WORDS.size], at)
                }
                k++
            }
            return cues
        }
        if (advancedAirway) {
            val cues = mutableListOf<Cue>()
            var k = floor(previousElapsed / ADVANCED_AIRWAY_BREATH_INTERVAL).toInt() + 1
            while (k * ADVANCED_AIRWAY_BREATH_INTERVAL <= elapsed) {
                val at = k * ADVANCED_AIRWAY_BREATH_INTERVAL
                if (at > 0) cues += Cue(CueKind.Breath, GIVE_BREATH_TEXT, at)
                k++
            }
            return cues
        }
        val period = compressionSetInterval(mode) ?: return emptyList()
        val cues = mutableListOf<Cue>()
        var k = floor(previousElapsed / period).toInt() + 1
        while (k * period <= elapsed) {
            val at = k * period
            if (at > 0) cues += Cue(CueKind.Breath, TWO_BREATHS_TEXT, at)
            k++
        }
        return cues
    }

    private fun sortKey(kind: CueKind): Int = when (kind) {
        CueKind.Voice -> 0
        CueKind.Breath -> 1
        CueKind.Metronome -> 2
    }
}

/**
 * Speech output behind an interface so the cue engine stays testable and the synthesiser is
 * injected. The UI passes a [WearSpeechOutput]; tests pass a stub.
 */
interface SpeechOutput {
    /** False when speech is unavailable, in which case the caller falls back to haptics. */
    val canSpeak: Boolean
    fun speak(text: String)
}

/**
 * Renders due cues: anything with text is spoken, bare ticks fall back to a haptic. Mute
 * classes stay independent in [CueEngine]; this only renders what the engine returned.
 */
object CueAnnouncer {
    fun announce(
        cues: List<Cue>,
        speech: SpeechOutput?,
        onHaptic: (CueKind) -> Unit,
    ) {
        for (cue in cues) {
            val text = cue.text
            if (text != null && speech?.canSpeak == true) {
                speech.speak(text)
            } else {
                onHaptic(cue.kind)
            }
        }
    }
}
