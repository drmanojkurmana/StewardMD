package `in`.stewardmd.wear.net

import `in`.stewardmd.wear.model.Patient
import kotlinx.serialization.Serializable

// Responses
@Serializable data class OkResp(val ok: Boolean = false, val error: String? = null, val idempotent: Boolean = false)
@Serializable data class LoginResp(val token: String? = null)
@Serializable data class GhisPatientsResp(val patients: List<Patient> = emptyList())

// Request bodies (shapes verified against functions/api/watch/[[path]].js + the ghis routes)
@Serializable data class AddReq(val patient: Patient)
@Serializable data class RemoveReq(val patientId: String)
@Serializable data class AckReq(val id: String, val labId: String, val patientLabel: String, val ackedAt: Long)
@Serializable data class TaskReq(val gid: String, val pid: String, val taskId: String, val status: String)
@Serializable data class TimelineReq(val gid: String, val pid: String, val type: String, val title: String, val detail: String)
@Serializable data class InstructionReq(val gid: String, val pid: String, val text: String, val priority: String)
@Serializable data class CodeblueReq(val event: String)
@Serializable data class LoginReq(val userId: String, val password: String)

internal fun enc(s: String): String = java.net.URLEncoder.encode(s, "UTF-8")
