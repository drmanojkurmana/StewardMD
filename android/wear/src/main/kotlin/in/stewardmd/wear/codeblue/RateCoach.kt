package `in`.stewardmd.wear.codeblue

/**
 * Maps an estimated compression RATE to the AHA target band. Port of WatchCore RateCoach. Copy is
 * strictly rate-matching guidance — NEVER a CPR-quality/adequacy verdict, NEVER depth (design §0).
 */
enum class RateZone { Idle, TooSlow, OnTarget, TooFast }

object RateCoach {
    const val LOWER = 100
    const val UPPER = 120

    fun zone(rateCpm: Int, active: Boolean): RateZone {
        if (!active || rateCpm <= 0) return RateZone.Idle
        return when {
            rateCpm < LOWER -> RateZone.TooSlow
            rateCpm > UPPER -> RateZone.TooFast
            else -> RateZone.OnTarget
        }
    }

    /** Rate-matching guidance only. */
    fun label(zone: RateZone): String = when (zone) {
        RateZone.Idle -> "—"
        RateZone.TooSlow -> "Push faster"
        RateZone.OnTarget -> "On target"
        RateZone.TooFast -> "Push slower"
    }
}
