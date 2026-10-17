package `in`.stewardmd.wear.codeblue

import android.content.Context
import android.content.SharedPreferences
import kotlinx.serialization.Serializable

/** v2 session snapshot. Saved on every event and at most every 5 s on tick. */
@Serializable
data class SessionSnapshot(
    val version: Int = VERSION,
    val mode: CodeMode = CodeMode.Adult,
    val startedAtWallClock: Long = 0L,
    val elapsedAtSave: Int = 0,
    val events: List<CodeEvent> = emptyList(),
    val adrenalineCount: Int = 0,
    val shockCount: Int = 0,
    val rosc: Boolean = false,
    val checklistTicks: List<String> = emptyList(),
    val savedAtWallClock: Long = 0L,
) {
    companion object {
        const val VERSION = 2

        /** Discard snapshots older than 6 h. */
        const val MAX_AGE_MILLIS = 6L * 3600L * 1000L
    }
}

/** Injectable clock so restore logic is unit-testable. */
fun interface CodeBlueClock {
    fun nowMillis(): Long
}

object SystemCodeBlueClock : CodeBlueClock {
    override fun nowMillis(): Long = System.currentTimeMillis()
}

/** SharedPreferences persistence for the v2 snapshot. */
class CodeBlueSessionStore(
    private val prefs: SharedPreferences,
    private val clock: CodeBlueClock = SystemCodeBlueClock,
) {
    fun save(model: CodeBlueModel) {
        val snap = SessionSnapshot(
            mode = model.mode,
            startedAtWallClock = model.startedAtWallClock,
            elapsedAtSave = model.elapsedSeconds,
            events = model.events.toList(),
            adrenalineCount = model.adrenalineCount,
            shockCount = model.shockCount,
            rosc = model.rosc,
            checklistTicks = model.checklistTicks.toList(),
            savedAtWallClock = clock.nowMillis(),
        )
        prefs.edit().putString(KEY, CodeBlueJson.encodeToString(SessionSnapshot.serializer(), snap)).apply()
    }

    /** Returns a restorable snapshot, or null when none exists or it is older than 6 h. */
    fun loadRestorable(): SessionSnapshot? {
        val raw = prefs.getString(KEY, null) ?: return null
        val snap = runCatching { CodeBlueJson.decodeFromString(SessionSnapshot.serializer(), raw) }.getOrNull()
            ?: return null
        if (clock.nowMillis() - snap.savedAtWallClock > SessionSnapshot.MAX_AGE_MILLIS) {
            clear()
            return null
        }
        return snap
    }

    fun clear() {
        prefs.edit().remove(KEY).apply()
    }

    companion object {
        const val PREFS = "codeblue_session"
        const val KEY = "snapshot_v2"

        fun forContext(context: Context, clock: CodeBlueClock = SystemCodeBlueClock): CodeBlueSessionStore =
            CodeBlueSessionStore(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE), clock)
    }
}

