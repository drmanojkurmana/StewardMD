package `in`.stewardmd.wear.codeblue

enum class EventKind { Start, Rhythm, Shock, Drug, Rosc, End }

data class CodeEvent(val seq: Int, val elapsedSeconds: Int, val kind: EventKind, val text: String)

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

/**
 * Code-timer + event log. Port of WatchCore CodeBlueModel. Drug/rhythm cues are REMINDERS (ACLS
 * cadence), never orders. Advanced by [tick]; a true return means a rhythm-check boundary was crossed.
 */
class CodeBlueModel(private val cycleSeconds: Int = 120) {
    var elapsedSeconds = 0; private set
    var cycle = 1; private set
    var shockCount = 0; private set
    var adrenalineCount = 0; private set
    var rosc = false; private set
    val events = mutableListOf<CodeEvent>()
    private var seq = 0

    init { append(EventKind.Start, "Code started") }

    /** Advance the clock; returns true iff a 2-minute rhythm-check boundary was crossed. */
    fun tick(dtSeconds: Int): Boolean {
        elapsedSeconds += dtSeconds
        val newCycle = elapsedSeconds / cycleSeconds + 1
        val crossed = newCycle > cycle
        if (crossed) { cycle = newCycle; append(EventKind.Rhythm, "Rhythm check") }
        return crossed
    }

    /** ACLS cadence reminder for the current cycle (odd → adrenaline, even → antiarrhythmic if shockable). */
    val drugPrompt: String
        get() = if (cycle % 2 == 1) "Adrenaline 1 mg" else "Amiodarone 300 mg (if shockable)"

    fun recordShock(energyJ: Int? = null) {
        shockCount++
        append(EventKind.Shock, "Shock #$shockCount" + (energyJ?.let { " · ${it}J" } ?: ""))
    }

    fun recordAdrenaline() {
        adrenalineCount++
        append(EventKind.Drug, "Adrenaline 1 mg (#$adrenalineCount)")
    }

    fun recordRhythm(label: String) = append(EventKind.Rhythm, label)

    fun recordRosc() { rosc = true; append(EventKind.Rosc, "ROSC") }

    fun end(): CodeSummary {
        append(EventKind.End, "Code ended")
        return CodeSummary(elapsedSeconds, cycle, shockCount, adrenalineCount, rosc, events.toList())
    }

    private fun append(kind: EventKind, text: String) {
        events.add(CodeEvent(++seq, elapsedSeconds, kind, text))
    }
}
