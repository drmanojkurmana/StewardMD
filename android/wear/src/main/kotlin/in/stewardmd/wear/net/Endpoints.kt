package `in`.stewardmd.wear.net

/** Backend paths — verified against functions/api/watch/[[path]].js + the ghis routes. */
object Endpoints {
    const val WATCH_STATUS = "/api/watch/status"
    const val WATCH_ENABLE = "/api/watch/enable"
    const val WATCH_ADD = "/api/watch/add"
    const val WATCH_REMOVE = "/api/watch/remove"
    const val WATCH_FORGET = "/api/watch/forget"
    const val WATCH_ACK = "/api/watch/ack"
    const val WATCH_TASK = "/api/watch/task"
    const val WATCH_TIMELINE = "/api/watch/timeline"
    const val WATCH_INSTRUCTION = "/api/watch/instruction"
    const val WATCH_CODEBLUE = "/api/watch/codeblue"
    const val GHIS_LOGIN = "/api/ghis/login"
    const val GHIS_PATIENTS = "/api/ghis/patients"
    const val GHIS_LAB = "/api/ghis/lab"
    const val GHIS_LAB_DETAIL = "/api/ghis/lab-detail"
    const val DRUG_BASE = "https://api.stewardmd.in"   // public, no auth (mirrors DrugAPI.swift)
}
