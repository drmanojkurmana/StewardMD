package `in`.stewardmd.wear.data

import `in`.stewardmd.wear.model.Patient
import `in`.stewardmd.wear.model.WatchStatus
import `in`.stewardmd.wear.net.AckReq
import `in`.stewardmd.wear.net.ApiClient
import `in`.stewardmd.wear.net.AddReq
import `in`.stewardmd.wear.net.CodeblueReq
import `in`.stewardmd.wear.net.Endpoints
import `in`.stewardmd.wear.net.InstructionReq
import `in`.stewardmd.wear.net.OkResp
import `in`.stewardmd.wear.net.RemoveReq
import `in`.stewardmd.wear.net.TaskReq
import `in`.stewardmd.wear.net.TimelineReq

/** All watch endpoints under /api/watch (Firebase Bearer). A 403 surfaces as ApiError.HttpError(403),
 *  which the caller maps to "not permitted"; a 402 (needs-pro) likewise via HttpError(402). */
class WatchApi(private val api: ApiClient) {

    suspend fun status(): WatchStatus = api.get(Endpoints.WATCH_STATUS, needsAuth = true)

    suspend fun add(patient: Patient): WatchStatus =
        api.post(Endpoints.WATCH_ADD, AddReq(patient), needsAuth = true)

    suspend fun remove(patientId: String): WatchStatus =
        api.post(Endpoints.WATCH_REMOVE, RemoveReq(patientId), needsAuth = true)

    suspend fun forget(): WatchStatus = api.post(Endpoints.WATCH_FORGET, needsAuth = true)

    suspend fun ack(id: String, labId: String, patientLabel: String, ackedAt: Long): OkResp =
        api.post(Endpoints.WATCH_ACK, AckReq(id, labId, patientLabel, ackedAt), needsAuth = true)

    suspend fun setTaskStatus(gid: String, pid: String, taskId: String, status: String): OkResp =
        api.post(Endpoints.WATCH_TASK, TaskReq(gid, pid, taskId, status), needsAuth = true)

    suspend fun postTimeline(gid: String, pid: String, detail: String, type: String = "handover", title: String = "Shift handover"): OkResp =
        api.post(Endpoints.WATCH_TIMELINE, TimelineReq(gid, pid, type, title, detail), needsAuth = true)

    suspend fun postInstruction(gid: String, pid: String, text: String, priority: String = "high"): OkResp =
        api.post(Endpoints.WATCH_INSTRUCTION, InstructionReq(gid, pid, text, priority), needsAuth = true)

    suspend fun codeblueStart(): OkResp =
        api.post(Endpoints.WATCH_CODEBLUE, CodeblueReq("start"), needsAuth = true)
}
