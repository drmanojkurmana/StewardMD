package `in`.stewardmd.wear.calc

/** Arterial blood-gas quick interpreter. Byte-for-byte port of WatchCore ABGInterpreter (design §06).
 *  Screening support only — not a substitute for full clinical assessment. Offline, no PHI. */
enum class PCO2Unit { KPA, MMHG }

enum class Disorder(val label: String) {
    NORMAL("Normal / compensated"),
    METABOLIC_ACIDOSIS("Metabolic acidosis"),
    RESPIRATORY_ACIDOSIS("Respiratory acidosis"),
    METABOLIC_ALKALOSIS("Metabolic alkalosis"),
    RESPIRATORY_ALKALOSIS("Respiratory alkalosis"),
}

enum class Compensation(val label: String) {
    NONE("Uncompensated"),
    PARTIAL("Partial compensation"),
    FULL("Fully compensated"),
}

data class AbgResult(val primary: Disorder, val compensation: Compensation, val anionGap: Double?) {
    val raisedAnionGap: Boolean get() = (anionGap ?: 0.0) > 12
}

object AbgInterpreter {
    private fun bounds(u: PCO2Unit): Pair<Double, Double> =
        if (u == PCO2Unit.KPA) 4.7 to 6.0 else 35.0 to 45.0

    fun interpret(
        pH: Double,
        pCO2: Double,
        hco3: Double,
        units: PCO2Unit = PCO2Unit.KPA,
        na: Double? = null,
        cl: Double? = null,
    ): AbgResult {
        val (lo, hi) = bounds(units)
        val ag: Double? = if (na != null && cl != null) na - (cl + hco3) else null

        val primary: Disorder
        var compensation = Compensation.NONE

        if (pH < 7.35) {                              // acidaemia
            primary = when {
                hco3 < 22 -> Disorder.METABOLIC_ACIDOSIS
                pCO2 > hi -> Disorder.RESPIRATORY_ACIDOSIS
                else -> Disorder.METABOLIC_ACIDOSIS
            }
            if (primary == Disorder.METABOLIC_ACIDOSIS && pCO2 < lo) compensation = Compensation.PARTIAL
            if (primary == Disorder.RESPIRATORY_ACIDOSIS && hco3 > 26) compensation = Compensation.PARTIAL
        } else if (pH > 7.45) {                       // alkalaemia
            primary = when {
                hco3 > 26 -> Disorder.METABOLIC_ALKALOSIS
                pCO2 < lo -> Disorder.RESPIRATORY_ALKALOSIS
                else -> Disorder.METABOLIC_ALKALOSIS
            }
            if (primary == Disorder.METABOLIC_ALKALOSIS && pCO2 > hi) compensation = Compensation.PARTIAL
            if (primary == Disorder.RESPIRATORY_ALKALOSIS && hco3 < 22) compensation = Compensation.PARTIAL
        } else {                                      // normal pH
            val deranged = hco3 < 22 || hco3 > 26 || pCO2 < lo || pCO2 > hi
            primary = Disorder.NORMAL
            compensation = if (deranged) Compensation.FULL else Compensation.NONE
        }
        return AbgResult(primary, compensation, ag)
    }
}
