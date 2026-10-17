package `in`.stewardmd.wear.codeblue

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Event kinds. Wire names are camelCase per the shared v2 spec; old payloads (cprStart, shock,
 * drug, rhythm, rosc, cprEnd without `edited`) still decode.
 */
@Serializable
enum class EventKind {
    @SerialName("cprStart") Start,
    @SerialName("rhythm") Rhythm,
    @SerialName("shock") Shock,
    @SerialName("drug") Drug,
    @SerialName("rosc") Rosc,
    @SerialName("cprEnd") End,
    @SerialName("pauseStart") PauseStart,
    @SerialName("resume") Resume,
    @SerialName("switchCompressor") SwitchCompressor,
    @SerialName("procedure") Procedure,
    @SerialName("reArrest") ReArrest,
    @SerialName("note") Note,
    @SerialName("modeSet") ModeSet,
}

/**
 * One logged event. `edited` is new in v2 and defaults to false so old JSON still decodes.
 * Deletion is NOT stored: deleting removes the event (undo keeps one in-memory slot in the model).
 */
@Serializable
data class CodeEvent(
    val seq: Int,
    val elapsedSeconds: Int,
    val kind: EventKind,
    val text: String,
    val id: String = "e$seq",
    val edited: Boolean = false,
)

data class CodeSummary(
    val durationSeconds: Int,
    val cycles: Int,
    val shockCount: Int,
    val adrenalineCount: Int,
    val rosc: Boolean,
    val events: List<CodeEvent>,
) {
    /** One-line chart detail (posted to the ICU timeline). Debrief metrics, not a quality verdict. */
    fun toDetail(): String =
        "CPR ${durationSeconds}s · $cycles cycles · shocks $shockCount · adrenaline $adrenalineCount · " +
            if (rosc) "ROSC" else "no ROSC"
}

/** Epinephrine reminder state. Countdown starts when the first dose is logged. */
enum class EpiStatus { NotStarted, Countdown, Due, Overdue }

/**
 * Code-timer + event log. Port of WatchCore CodeBlueModel. Drug/rhythm cues are REMINDERS (ACLS
 * cadence), never orders. Advanced by [tick]; a true return means a rhythm-check boundary was crossed.
 *
 * v2 adds: [CodeMode] with per-mode rhythm intervals, procedure logging with a fixed vocabulary,
 * re-arrest, an editable log (edit label, delete, undo), a post-ROSC checklist, an epinephrine
 * due/overdue timer, session snapshots and the v2 code sheet. New content carries no drug doses.
 */
class CodeBlueModel(
    mode: CodeMode = CodeMode.Adult,
    private var cycleSeconds: Int = mode.rhythmCheckSeconds,
    startedAtWallClock: Long = System.currentTimeMillis(),
) {
    var mode: CodeMode = mode
        private set
    var startedAtWallClock: Long = startedAtWallClock
        private set
    var elapsedSeconds = 0; private set
    var cycle = 1; private set
    var shockCount = 0; private set
    var adrenalineCount = 0; private set
    var rosc = false; private set
    var lastRhythmLabel: String? = null; private set
    var lastEpiElapsed: Int? = null; private set
    var advancedAirway = false; private set
    val events = mutableListOf<CodeEvent>()
    val checklistTicks = mutableSetOf<String>()
    private var seq = 0
    private var deletedSlot: Pair<CodeEvent, Int>? = null
    private var cycleBaseSeconds = 0

    init { append(EventKind.Start, "Code started") }

    /** Advance the clock; returns true iff a rhythm-check boundary was crossed. */
    fun tick(dtSeconds: Int): Boolean {
        elapsedSeconds += dtSeconds
        val newCycle = (elapsedSeconds - cycleBaseSeconds) / cycleSeconds + 1
        val crossed = newCycle > cycle
        if (crossed) { cycle = newCycle; append(EventKind.Rhythm, "Rhythm check") }
        return crossed
    }

    /** ACLS cadence reminder for the current cycle (odd → adrenaline, even → antiarrhythmic if shockable). */
    val drugPrompt: String
        get() = when (mode) {
            CodeMode.Adult -> if (cycle % 2 == 1) "Adrenaline 1 mg" else "Amiodarone 300 mg (if shockable)"
            // Paediatric and neonatal doses are weight-based: never show the adult figure there.
            CodeMode.Paediatric -> if (cycle % 2 == 1) "Epinephrine due (dose per weight, local protocol)" else "Antiarrhythmic if shockable (per local protocol)"
            CodeMode.Neonatal -> "Epinephrine if heart rate stays below 60 after effective ventilation and compressions (dose per protocol)"
        }

    fun setMode(newMode: CodeMode) {
        if (newMode == mode) return
        mode = newMode
        cycleSeconds = newMode.rhythmCheckSeconds
        cycle = (elapsedSeconds - cycleBaseSeconds) / cycleSeconds + 1
        append(EventKind.ModeSet, "Mode set to ${modeLabel(newMode)}")
    }

    fun recordShock(energyJ: Int? = null) {
        shockCount++
        append(EventKind.Shock, "Shock #$shockCount" + (energyJ?.let { " · ${it}J" } ?: ""))
    }

    fun recordAdrenaline() {
        adrenalineCount++
        lastEpiElapsed = elapsedSeconds
        append(EventKind.Drug, if (mode == CodeMode.Adult) "Adrenaline 1 mg (#$adrenalineCount)" else "Adrenaline (#$adrenalineCount)")
    }

    fun recordRhythm(label: String) {
        lastRhythmLabel = label
        append(EventKind.Rhythm, label)
    }

    fun recordProcedure(label: String) {
        if (label == "Advanced airway") advancedAirway = true
        append(EventKind.Procedure, label)
    }

    fun recordNote(text: String) = append(EventKind.Note, text)

    fun recordPause() = append(EventKind.PauseStart, "Compressions paused")

    fun recordResume() = append(EventKind.Resume, "Compressions resumed")

    fun recordSwitchCompressor() = append(EventKind.SwitchCompressor, "Compressor switched")

    fun recordRosc() { rosc = true; append(EventKind.Rosc, "ROSC") }

    /**
     * Re-arrest: one action after ROSC. Clears rosc, logs reArrest, starts a new CPR cycle at the
     * same mode. The epinephrine timer continues from the last dose.
     */
    fun recordRearrest() {
        rosc = false
        cycleBaseSeconds = elapsedSeconds
        cycle = 1
        append(EventKind.ReArrest, "Re-arrest. New CPR cycle started")
    }

    /** Tick a post-ROSC checklist item; each tick logs a note event. Returns false for unknown ids. */
    fun tickChecklist(item: ChecklistItem): Boolean {
        if (PostRoscChecklist.items(mode).none { it.id == item.id }) return false
        if (checklistTicks.add(item.id)) append(EventKind.Note, "Checklist ticked: ${item.text}")
        return true
    }

    fun untickChecklist(itemId: String) {
        checklistTicks.remove(itemId)
    }

    /** Seconds since the last epinephrine dose, or null before the first dose. */
    val secondsSinceEpi: Int?
        get() = lastEpiElapsed?.let { elapsedSeconds - it }

    val epiStatus: EpiStatus
        get() {
            val s = secondsSinceEpi ?: return EpiStatus.NotStarted
            return when {
                s >= EPI_OVERDUE_SECONDS -> EpiStatus.Overdue
                s >= EPI_DUE_SECONDS -> EpiStatus.Due
                else -> EpiStatus.Countdown
            }
        }

    /** Watch chip label. Timing words only, never a dose. */
    fun epiLabel(): String = when (epiStatus) {
        EpiStatus.NotStarted -> "Epinephrine not yet given"
        EpiStatus.Countdown -> {
            val left = EPI_DUE_SECONDS - (secondsSinceEpi ?: 0)
            "Epinephrine in ${left / 60}:${"%02d".format(left % 60)}"
        }
        EpiStatus.Due -> "Epinephrine due"
        EpiStatus.Overdue -> "Epinephrine overdue"
    }

    /** Rhythm-check interval for the current mode (drives the watch ring). */
    val cycleIntervalSeconds: Int
        get() = cycleSeconds

    /** Compression label for the current mode, honouring an advanced airway (adult/paediatric). */
    fun compressionLabel(): String =
        if (advancedAirway && mode != CodeMode.Neonatal) ADVANCED_AIRWAY_LABEL else mode.compressionLabel

    /** Current algorithm prompts for the guide strip. */
    fun guidePrompts(): List<GuidePrompt> = AlgorithmGuide.prompts(
        GuideInput(mode, lastRhythmLabel, shockCount, adrenalineCount, secondsSinceEpi, rosc),
    )

    /** Edit an event label. The event keeps its elapsed time and gains the edited flag. */
    fun editEvent(seq: Int, newLabel: String): Boolean {
        val i = events.indexOfFirst { it.seq == seq }
        if (i < 0) return false
        events[i] = events[i].copy(text = newLabel, edited = true)
        recomputeDerived()
        return true
    }

    /** Delete an event (removes it; one undo slot is kept). Counts are recomputed. */
    fun deleteEvent(seq: Int): Boolean {
        val i = events.indexOfFirst { it.seq == seq }
        if (i < 0) return false
        deletedSlot = events[i] to i
        events.removeAt(i)
        recomputeDerived()
        return true
    }

    /** Restore the last deleted event at its original position. */
    fun undoDelete(): Boolean {
        val (event, index) = deletedSlot ?: return false
        events.add(index.coerceIn(0, events.size), event)
        deletedSlot = null
        recomputeDerived()
        return true
    }

    fun hasDeletedToUndo(): Boolean = deletedSlot != null

    private fun recomputeCounts() {
        shockCount = events.count { it.kind == EventKind.Shock }
        adrenalineCount = events.count { it.kind == EventKind.Drug }
    }

    private fun recomputeDerived() {
        recomputeCounts()
        lastRhythmLabel = events.lastOrNull { it.kind == EventKind.Rhythm && it.text != "Rhythm check" }?.text
        lastEpiElapsed = events.filter { it.kind == EventKind.Drug }.maxOfOrNull { it.elapsedSeconds }
        advancedAirway = events.any { it.kind == EventKind.Procedure && it.text == "Advanced airway" }
    }

    /**
     * Apply a snapshot. Returns false (model untouched) when the snapshot is older than 6 h.
     * Otherwise elapsed = elapsedAtSave + (now - savedAt) while running.
     */
    fun restoreFrom(snap: SessionSnapshot, nowWallClock: Long): Boolean {
        if (nowWallClock - snap.savedAtWallClock > SessionSnapshot.MAX_AGE_MILLIS) return false
        setMode(snap.mode)
        startedAtWallClock = snap.startedAtWallClock
        elapsedSeconds = snap.elapsedAtSave + ((nowWallClock - snap.savedAtWallClock) / 1000).toInt()
        events.clear()
        events.addAll(snap.events)
        checklistTicks.clear()
        checklistTicks.addAll(snap.checklistTicks)
        rosc = snap.rosc
        lastRhythmLabel = snap.events.lastOrNull { it.kind == EventKind.Rhythm && it.text != "Rhythm check" }?.text
        lastEpiElapsed = snap.events.filter { it.kind == EventKind.Drug }.maxOfOrNull { it.elapsedSeconds }
        advancedAirway = snap.events.any { it.kind == EventKind.Procedure && it.text == "Advanced airway" }
        seq = (snap.events.maxOfOrNull { it.seq } ?: 0)
        cycleBaseSeconds = 0
        cycle = elapsedSeconds / cycleSeconds + 1
        shockCount = events.count { it.kind == EventKind.Shock }
        adrenalineCount = events.count { it.kind == EventKind.Drug }
        return true
    }

    fun end(): CodeSummary {
        append(EventKind.End, "Code ended")
        return CodeSummary(elapsedSeconds, cycle, shockCount, adrenalineCount, rosc, events.toList())
    }

    private fun append(kind: EventKind, text: String) {
        events.add(CodeEvent(++seq, elapsedSeconds, kind, text))
    }

    companion object {
        fun modeLabel(mode: CodeMode): String = when (mode) {
            CodeMode.Adult -> "Adult"
            CodeMode.Paediatric -> "Paediatric"
            CodeMode.Neonatal -> "Neonatal"
        }
    }
}
