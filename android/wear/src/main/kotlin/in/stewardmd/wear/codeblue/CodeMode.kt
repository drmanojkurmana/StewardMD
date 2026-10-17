package `in`.stewardmd.wear.codeblue

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Resuscitation mode. Serial values ("adult", "paediatric", "neonatal") are shared with Swift. */
@Serializable
enum class CodeMode(val serial: String) {
    @SerialName("adult") Adult("adult"),
    @SerialName("paediatric") Paediatric("paediatric"),
    @SerialName("neonatal") Neonatal("neonatal");

    /** Seconds between rhythm checks (neonatal: heart-rate check, as per NRP). */
    val rhythmCheckSeconds: Int
        get() = when (this) {
            Adult, Paediatric -> 120
            Neonatal -> 60
        }

    /** Compression to ventilation label for this mode. */
    val compressionLabel: String
        get() = when (this) {
            Adult -> "30:2 (100 to 120 per min)"
            Paediatric -> "15:2 with two rescuers, 30:2 alone"
            Neonatal -> "3:1 (90 compressions and 30 breaths per min)"
        }

    companion object {
        fun fromSerial(value: String): CodeMode =
            entries.firstOrNull { it.serial == value } ?: Adult
    }
}

/** Epinephrine reminder cadence (3 to 5 min rule), all modes. Countdown starts at the first dose. */
const val EPI_DUE_SECONDS = 180
const val EPI_OVERDUE_SECONDS = 300

/** Label used once an advanced airway is placed (adult and paediatric). */
const val ADVANCED_AIRWAY_LABEL = "Continuous compressions, 1 breath every 6 seconds"

/** Fixed procedure vocabulary. Free text goes in a note event. */
val PROCEDURE_LABELS = listOf(
    "IV access",
    "IO access",
    "Advanced airway",
    "ETCO2 on",
    "Pads on",
    "Central line",
    "Arterial line",
)

/** Fixed rhythm vocabulary, shared with Swift. */
val RHYTHM_LABELS = listOf(
    "VF",
    "VT (pulseless)",
    "PEA",
    "Asystole",
    "Sinus rhythm (pulse)",
    "Bradycardia (pulse)",
    "Tachycardia (pulse)",
)

/** Quick notes for the watch (no keyboard): presets only, free text stays on the phone sheet. */
val QUICK_NOTES = listOf(
    "Airway reassessed",
    "Team switch done",
    "Access confirmed",
    "Family updated",
    "Reversible causes reviewed",
)

/** Shown wherever the feature is entered. Exact wording from the shared spec. */
const val CODE_BLUE_DISCLAIMER =
    "Timer, reminder, documentation and practice aid only. " +
        "Not a substitute for clinical judgement, formal resuscitation training or your institution's protocol."

/** Kept on every summary: motion sensing is rate only, never a quality verdict. */
const val MOTION_DISCLAIMER = "Motion-based estimates, not a measure of CPR quality or depth."
