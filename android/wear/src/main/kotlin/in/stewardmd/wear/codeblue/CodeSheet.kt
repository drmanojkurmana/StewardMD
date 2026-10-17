package `in`.stewardmd.wear.codeblue

import java.time.Instant
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** Wire name for an event kind. Must match the Swift side exactly. */
fun kindSerial(kind: EventKind): String = when (kind) {
    EventKind.Start -> "cprStart"
    EventKind.Rhythm -> "rhythm"
    EventKind.Shock -> "shock"
    EventKind.Drug -> "drug"
    EventKind.Rosc -> "rosc"
    EventKind.End -> "cprEnd"
    EventKind.PauseStart -> "pauseStart"
    EventKind.Resume -> "resume"
    EventKind.SwitchCompressor -> "switchCompressor"
    EventKind.Procedure -> "procedure"
    EventKind.ReArrest -> "reArrest"
    EventKind.Note -> "note"
    EventKind.ModeSet -> "modeSet"
}

/** Motion metrics fed in from the service at sheet time. Unknown values stay zero. */
data class SheetMetrics(
    val compressions: Int = 0,
    val averageRateCPM: Int = 0,
    val compressionFractionPct: Int = 0,
    val targetRatePct: Int = 0,
)

fun startedAtIso(model: CodeBlueModel): String =
    runCatching { Instant.ofEpochMilli(model.startedAtWallClock).toString() }.getOrDefault("")

/** v2 JSON payload, byte-identical in shape to the Swift side. */
fun codeSheetJson(model: CodeBlueModel, metrics: SheetMetrics = SheetMetrics()): String {
    val events = JsonArray(
        model.events.map { e ->
            JsonObject(
                mapOf(
                    "id" to JsonPrimitive(e.id),
                    "elapsed" to JsonPrimitive(e.elapsedSeconds),
                    "kind" to JsonPrimitive(kindSerial(e.kind)),
                    "label" to JsonPrimitive(e.text),
                    "edited" to JsonPrimitive(e.edited),
                ),
            )
        },
    )
    val payload = JsonObject(
        mapOf(
            "v" to JsonPrimitive(2),
            "mode" to JsonPrimitive(model.mode.serial),
            "startedAt" to JsonPrimitive(startedAtIso(model)),
            "durationSeconds" to JsonPrimitive(model.elapsedSeconds),
            "cycles" to JsonPrimitive(model.cycle),
            "events" to events,
            "summary" to JsonObject(
                mapOf(
                    "compressions" to JsonPrimitive(metrics.compressions),
                    "averageRateCPM" to JsonPrimitive(metrics.averageRateCPM),
                    "compressionFractionPct" to JsonPrimitive(metrics.compressionFractionPct),
                    "targetRatePct" to JsonPrimitive(metrics.targetRatePct),
                    "shockCount" to JsonPrimitive(model.shockCount),
                    "adrenalineCount" to JsonPrimitive(model.adrenalineCount),
                    "rosc" to JsonPrimitive(model.rosc),
                ),
            ),
            "disclaimer" to JsonPrimitive(MOTION_DISCLAIMER),
        ),
    )
    return payload.toString()
}

/** Plain-text rendering of the code sheet: the shared fallback when JSON cannot be used. */
fun codeSheetText(model: CodeBlueModel, metrics: SheetMetrics = SheetMetrics()): String {
    val sb = StringBuilder()
    sb.appendLine("Code sheet (StewardMD)")
    sb.appendLine("Mode: ${CodeBlueModel.modeLabel(model.mode)}")
    sb.appendLine("Started: ${startedAtIso(model)}")
    sb.appendLine("Duration: ${model.elapsedSeconds}s in ${model.cycle} cycles")
    sb.appendLine("Compressions: ${metrics.compressions} at ${metrics.averageRateCPM} per min")
    sb.appendLine("Shocks: ${model.shockCount}. Adrenaline: ${model.adrenalineCount}. ROSC: ${if (model.rosc) "yes" else "no"}")
    sb.appendLine("Events:")
    for (e in model.events) {
        sb.appendLine("${mmssLabel(e.elapsedSeconds)} ${kindSerial(e.kind)}: ${e.text}${if (e.edited) " (edited)" else ""}")
    }
    sb.appendLine(CODE_BLUE_DISCLAIMER)
    sb.appendLine(MOTION_DISCLAIMER)
    return sb.toString()
}

private fun mmssLabel(totalSeconds: Int): String = "%d:%02d".format(totalSeconds / 60, totalSeconds % 60)

/** Lenient JSON helper shared by snapshot and sheet readers. */
val CodeBlueJson = Json { ignoreUnknownKeys = true; coerceInputValues = true; explicitNulls = false }
