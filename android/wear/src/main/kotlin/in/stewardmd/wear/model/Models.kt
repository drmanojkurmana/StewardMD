package `in`.stewardmd.wear.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Shapes mirror the StewardMD backend JSON. All fields nullable/defaulted + Json(ignoreUnknownKeys)
 *  so unexpected/missing keys never crash the watch. */

@Serializable
data class Patient(
    @SerialName("patientId") val patientId: String = "",
    val name: String? = null,
    val bedName: String? = null,
    val deptDescription: String? = null,
)

@Serializable
data class Order(
    val renderId: String? = null,
    val orderId: String? = null,
    val episodeId: String? = null,
    val serviceName: String? = null,
) {
    val rid: String get() = (renderId ?: orderId ?: "")
}

@Serializable
data class Lab(val orders: List<Order> = emptyList())

// ponytail: `result` typed String? for now; GHIS may send a numeric result — if so, switch to a
// tolerant JsonElement type. Confirm against real GHIS payloads in Task 6 (labs) on-device.
@Serializable
data class TestRow(val result: String? = null, val name: String? = null)

@Serializable
data class LabDetail(val tests: List<TestRow> = emptyList()) {
    /** Mirrors the server rule: an order has values only when some test has a non-empty result. */
    val hasValues: Boolean get() = tests.any { !it.result.isNullOrBlank() }
}

@Serializable
data class WatchStatus(val consented: Boolean = false, val watching: List<Patient> = emptyList())

@Serializable
data class WatchTask(
    val id: String = "",
    val text: String = "",
    val status: String = "pending",
    val assignedBy: String? = null,
    val ts: Long? = null,
)

/** A patient in a shared ICU unit — the pick-list entry feeding Tasks / Handover. */
data class PatientRef(
    val pid: String,
    val name: String,
    val bed: String? = null,
    val severity: String? = null,
)

/** Shared ICU patient board doc (top-level fields of icuGroups/{gid}/patients/{pid}). */
data class PatientState(
    val name: String? = null,
    val dx: String? = null,
    val bed: String? = null,
    val severity: String? = null,
)
