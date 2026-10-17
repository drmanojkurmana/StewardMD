package `in`.stewardmd.wear.codeblue

/** One post-ROSC checklist item. Ticking it logs a note event. */
data class ChecklistItem(val id: String, val text: String)

/** Post-ROSC checklist. Adult and paediatric share the list; neonatal has its own. */
object PostRoscChecklist {
    fun items(mode: CodeMode): List<ChecklistItem> = when (mode) {
        CodeMode.Adult, CodeMode.Paediatric -> listOf(
            ChecklistItem("airway", "Secure airway and titrate oxygen to SpO2 92 to 98 percent"),
            ChecklistItem("co2", "Ventilate to normal CO2"),
            ChecklistItem("pressure", "Avoid hypotension (systolic at least 90, MAP at least 65 in adults)"),
            ChecklistItem("ecg", "12-lead ECG"),
            ChecklistItem("glucose", "Blood glucose"),
            ChecklistItem("temperature", "Temperature control (avoid fever)"),
            ChecklistItem("cause", "Find and treat the cause (Hs and Ts)"),
            ChecklistItem("neuro", "Neuro assessment"),
            ChecklistItem("icu", "Transfer to ICU"),
        )
        CodeMode.Neonatal -> listOf(
            ChecklistItem("monitor", "Monitor breathing, heart rate and oxygenation"),
            ChecklistItem("glucose", "Blood glucose"),
            ChecklistItem("temperature", "Temperature control (avoid cold and heat stress)"),
            ChecklistItem("cooling", "Consider therapeutic hypothermia criteria"),
            ChecklistItem("parents", "Parental communication"),
        )
    }
}
