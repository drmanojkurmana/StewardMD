package `in`.stewardmd.wear.data

import `in`.stewardmd.wear.net.ApiClient
import `in`.stewardmd.wear.net.Endpoints
import `in`.stewardmd.wear.net.enc
import kotlinx.serialization.Serializable

// ponytail: tolerant shape (ignoreUnknownKeys). The public Worker's exact fields are confirmed on
// device (Task 9) — extra keys are ignored, so this won't crash if the schema is richer.
@Serializable
data class DrugHit(val name: String? = null, val generic: String? = null, val summary: String? = null) {
    val display: String get() = name ?: generic ?: "(unnamed)"
}

@Serializable
data class DrugSearchResponse(val results: List<DrugHit> = emptyList())

/** Public drug/dose lookup against api.stewardmd.in — NO auth (mirrors DrugAPI.swift). */
class DrugApi(private val api: ApiClient) {
    suspend fun search(query: String, limit: Int = 10): List<DrugHit> =
        api.get<DrugSearchResponse>(Endpoints.DRUG_BASE + "/search?q=" + enc(query) + "&limit=" + limit).results
}
