package `in`.stewardmd.wear.data

import `in`.stewardmd.wear.model.Lab
import `in`.stewardmd.wear.model.LabDetail
import `in`.stewardmd.wear.model.Patient
import `in`.stewardmd.wear.net.ApiClient
import `in`.stewardmd.wear.net.Endpoints
import `in`.stewardmd.wear.net.GhisPatientsResp
import `in`.stewardmd.wear.net.LoginReq
import `in`.stewardmd.wear.net.LoginResp
import `in`.stewardmd.wear.net.enc

/**
 * GHIS ward-lab calls. Auth is the GHIS session token (bridged from the phone over the Data Layer),
 * passed as an explicit Bearer — NOT the Firebase token. Mint via [login] only when the phone has no
 * live session.
 */
class GhisApi(private val api: ApiClient) {

    suspend fun login(userId: String, password: String): String? =
        api.post<LoginResp>(Endpoints.GHIS_LOGIN, LoginReq(userId, password)).token

    // ponytail: assumes {patients:[...]}. The server also accepts a bare array response — if GHIS
    // returns one, adapt here (device-verify in Task 6). Kept typed for the common shape.
    suspend fun patients(ghisToken: String): List<Patient> =
        api.get<GhisPatientsResp>(Endpoints.GHIS_PATIENTS, bearer = ghisToken).patients

    suspend fun labs(ghisToken: String, patientId: String): Lab =
        api.get(Endpoints.GHIS_LAB + "?patientId=" + enc(patientId), bearer = ghisToken)

    suspend fun labDetail(ghisToken: String, renderId: String, episodeId: String): LabDetail =
        api.get(Endpoints.GHIS_LAB_DETAIL + "?renderId=" + enc(renderId) + "&episodeId=" + enc(episodeId), bearer = ghisToken)
}
