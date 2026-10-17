package `in`.stewardmd.wear.codeblue

/** Prompt urgency. No drug doses are ever shown; timing words only. */
enum class GuideUrgency { Info, Due, Overdue }

/** One ordered algorithm prompt. Pure text, with a short source citation. */
data class GuidePrompt(
    val id: String,
    val text: String,
    val urgency: GuideUrgency,
    val source: String,
)

data class GuideInput(
    val mode: CodeMode,
    val lastRhythm: String?,
    val shockCount: Int,
    val epiCount: Int,
    val secondsSinceEpi: Int?,
    val rosc: Boolean,
)

private const val SRC_ARREST_ADULT = "AHA 2020 adult cardiac arrest algorithm"
private const val SRC_ARREST_PAED = "AHA 2020 paediatric cardiac arrest algorithm"
private const val SRC_NRP = "NRP 2020 neonatal resuscitation algorithm"
private const val SRC_BRADY = "AHA 2020 bradycardia algorithm"
private const val SRC_TACHY = "AHA 2020 tachycardia algorithm"
private const val SRC_POST = "AHA 2020 post cardiac arrest care"

private const val HS_TS =
    "Treat reversible causes: hypoxia, hypovolaemia, hypo or hyperkalaemia, " +
        "hypothermia, acidosis, hypoglycaemia, tamponade, tension pneumothorax, " +
        "coronary or pulmonary thrombosis, toxins"

private fun epiTimingPrompts(input: GuideInput, source: String): List<GuidePrompt> {
    val s = input.secondsSinceEpi ?: return emptyList()
    return when {
        s >= EPI_OVERDUE_SECONDS -> listOf(
            GuidePrompt("epi-overdue", "Epinephrine overdue. Give as soon as possible.", GuideUrgency.Overdue, source),
        )
        s >= EPI_DUE_SECONDS -> listOf(
            GuidePrompt("epi-due", "Epinephrine due.", GuideUrgency.Due, source),
        )
        else -> {
            val left = EPI_DUE_SECONDS - s
            listOf(
                GuidePrompt(
                    "epi-countdown",
                    "Epinephrine in ${left / 60}:${"%02d".format(left % 60)}.",
                    GuideUrgency.Info,
                    source,
                ),
            )
        }
    }
}

/**
 * AlgorithmGuide: pure, text only, never doses. Four tracks: cardiac arrest, bradycardia with a
 * pulse, tachycardia with a pulse, post-ROSC. Mirrors the Swift implementation prompt for prompt.
 */
object AlgorithmGuide {
    fun prompts(input: GuideInput): List<GuidePrompt> {
        if (input.rosc) return postRosc(input.mode)
        return when (input.lastRhythm) {
            "VF", "VT (pulseless)" -> arrestShockable(input)
            "PEA", "Asystole" -> arrestNonShockable(input)
            "Bradycardia (pulse)" -> bradycardia(input)
            "Tachycardia (pulse)" -> tachycardia(input)
            "Sinus rhythm (pulse)" -> monitored(input)
            else -> noRhythmYet(input)
        }
    }

    private fun arrestSource(mode: CodeMode): String = when (mode) {
        CodeMode.Adult -> SRC_ARREST_ADULT
        CodeMode.Paediatric -> SRC_ARREST_PAED
        CodeMode.Neonatal -> SRC_NRP
    }

    private fun cprCycleText(mode: CodeMode): String = when (mode) {
        CodeMode.Neonatal -> "Continue CPR, reassess heart rate every 60 seconds as per NRP"
        else -> "Continue CPR for 2 minutes, then rhythm check"
    }

    private fun arrestShockable(input: GuideInput): List<GuidePrompt> {
        val src = arrestSource(input.mode)
        val out = mutableListOf<GuidePrompt>()
        if (input.mode == CodeMode.Neonatal) {
            out += GuidePrompt("neo-vent", "Ventilation first. Start compressions if heart rate stays below 60 after 30 seconds of effective ventilation, then 3:1.", GuideUrgency.Info, src)
        }
        if (input.shockCount == 0) {
            out += GuidePrompt("shock", "Shockable rhythm. Deliver a shock, then resume CPR at once.", GuideUrgency.Due, src)
        } else {
            out += GuidePrompt("cpr", cprCycleText(input.mode) + ".", GuideUrgency.Info, src)
        }
        if (input.shockCount >= 2 && input.epiCount == 0) {
            out += GuidePrompt("epi-indicated", "Epinephrine indicated after the 2nd shock.", GuideUrgency.Due, src)
        }
        if (input.shockCount >= 3) {
            out += GuidePrompt("antiarrhythmic", "Amiodarone or lidocaine after the 3rd shock.", GuideUrgency.Info, src)
        }
        if (input.mode == CodeMode.Paediatric) {
            out += GuidePrompt("paed-note", "Paediatric arrest. Shock energy and dosing are not shown here. Follow your institution protocol.", GuideUrgency.Info, src)
        }
        out += epiTimingPrompts(input, src)
        out += GuidePrompt("hsts", "$HS_TS.", GuideUrgency.Info, src)
        return out
    }

    private fun arrestNonShockable(input: GuideInput): List<GuidePrompt> {
        val src = arrestSource(input.mode)
        val out = mutableListOf<GuidePrompt>()
        if (input.mode == CodeMode.Neonatal) {
            out += GuidePrompt("neo-vent", "Ventilation first. Start compressions if heart rate stays below 60 after 30 seconds of effective ventilation, then 3:1.", GuideUrgency.Info, src)
        }
        if (input.epiCount == 0) {
            out += GuidePrompt("epi-indicated", "Non-shockable rhythm. Epinephrine as soon as possible, then CPR.", GuideUrgency.Due, src)
        } else {
            out += GuidePrompt("cpr", cprCycleText(input.mode) + ".", GuideUrgency.Info, src)
        }
        out += epiTimingPrompts(input, src)
        out += GuidePrompt("hsts", "$HS_TS.", GuideUrgency.Info, src)
        return out
    }

    private fun bradycardia(input: GuideInput): List<GuidePrompt> {
        if (input.mode == CodeMode.Neonatal) {
            return listOf(
                GuidePrompt("neo-vent", "Ventilation first. Start compressions if heart rate stays below 60 after 30 seconds of effective ventilation.", GuideUrgency.Info, SRC_NRP),
                GuidePrompt("neo-monitor", "Monitor breathing, heart rate and oxygenation throughout.", GuideUrgency.Info, SRC_NRP),
            )
        }
        val out = mutableListOf(
            GuidePrompt("brady-perfusion", "Assess for poor perfusion. Support the airway and give oxygen.", GuideUrgency.Info, SRC_BRADY),
            GuidePrompt("brady-monitor", "Monitor rhythm, blood pressure and oximetry.", GuideUrgency.Info, SRC_BRADY),
            GuidePrompt("brady-treat", "Atropine, pacing or an infusion may be considered. Follow your institution protocol.", GuideUrgency.Info, SRC_BRADY),
        )
        if (input.mode == CodeMode.Paediatric) {
            out += GuidePrompt("brady-paed-cpr", "Paediatric: start compressions if heart rate stays below 60 with poor perfusion despite oxygenation and ventilation.", GuideUrgency.Due, SRC_BRADY)
        }
        return out
    }

    private fun tachycardia(input: GuideInput): List<GuidePrompt> {
        return listOf(
            GuidePrompt("tachy-assess", "Assess stability, QRS width and regularity.", GuideUrgency.Info, SRC_TACHY),
            GuidePrompt("tachy-unstable", "Unstable tachycardia: synchronised cardioversion.", GuideUrgency.Due, SRC_TACHY),
            GuidePrompt("tachy-narrow", "Stable narrow regular tachycardia: vagal manoeuvres, then adenosine.", GuideUrgency.Info, SRC_TACHY),
            GuidePrompt("tachy-wide", "Stable wide tachycardia: seek expert consultation.", GuideUrgency.Info, SRC_TACHY),
        )
    }

    private fun monitored(input: GuideInput): List<GuidePrompt> {
        return listOf(
            GuidePrompt("monitor-rhythm", "Pulse present. Monitor rhythm, blood pressure and oximetry.", GuideUrgency.Info, arrestSource(input.mode)),
            GuidePrompt("monitor-cause", "Look for and treat the underlying cause.", GuideUrgency.Info, arrestSource(input.mode)),
        )
    }

    private fun noRhythmYet(input: GuideInput): List<GuidePrompt> {
        val src = arrestSource(input.mode)
        return listOf(
            GuidePrompt("log-rhythm", "Log the rhythm to tailor the next prompts.", GuideUrgency.Info, src),
            GuidePrompt("cpr", cprCycleText(input.mode) + ".", GuideUrgency.Info, src),
        )
    }

    private fun postRosc(mode: CodeMode): List<GuidePrompt> {
        if (mode == CodeMode.Neonatal) {
            return listOf(
                GuidePrompt("post-neo", "Post resuscitation care: monitor, check glucose, control temperature and consider therapeutic hypothermia criteria.", GuideUrgency.Info, SRC_NRP),
                GuidePrompt("post-parents", "Communicate with the parents and document the course.", GuideUrgency.Info, SRC_NRP),
            )
        }
        return listOf(
            GuidePrompt("post-airway", "Secure the airway. Titrate oxygen to SpO2 92 to 98 percent.", GuideUrgency.Info, SRC_POST),
            GuidePrompt("post-pressure", "Avoid hypotension. Treat the cause using Hs and Ts.", GuideUrgency.Info, SRC_POST),
            GuidePrompt("post-workup", "12-lead ECG, blood glucose, temperature control and neuro assessment.", GuideUrgency.Info, SRC_POST),
        )
    }
}
