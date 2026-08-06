package `in`.stewardmd.wear.net

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.header
import io.ktor.client.request.request
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.contentType
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.Json

/** Supplies the current Firebase ID token (bridged from the phone — Task 3). */
fun interface AuthTokenProvider {
    suspend fun currentToken(): String?
}

sealed class ApiError(message: String) : Exception(message) {
    data object Unauthorized : ApiError("unauthorized")            // 401 — token missing/expired
    data class HttpError(val code: Int) : ApiError("http $code")   // any other non-2xx
    data class Transport(val err: Throwable) : ApiError("transport: ${err.message}")
}

/**
 * Thin Ktor wrapper. Attaches `Authorization: Bearer <token>` when [needsAuth]; maps 401 →
 * [ApiError.Unauthorized], other non-2xx → [ApiError.HttpError], network failure → [ApiError.Transport].
 * The server derives identity from the token — the client never asserts a uid.
 */
class ApiClient(
    engine: HttpClientEngine = OkHttp.create(),
    private val base: String = "https://stewardmd.in",
    private val tokenProvider: AuthTokenProvider = AuthTokenProvider { null },
) {
    val http = HttpClient(engine) {
        expectSuccess = false
        install(ContentNegotiation) {
            json(Json { ignoreUnknownKeys = true; coerceInputValues = true })
        }
    }

    /** Absolute URL when [path] already starts with http(s), else prefixed with [base]. */
    suspend fun request(method: HttpMethod, path: String, body: Any? = null, needsAuth: Boolean = false): HttpResponse {
        val url = if (path.startsWith("http")) path else base + path
        val resp = try {
            http.request(url) {
                this.method = method
                if (body != null) { contentType(ContentType.Application.Json); setBody(body) }
                if (needsAuth) tokenProvider.currentToken()?.let { header(HttpHeaders.Authorization, "Bearer $it") }
            }
        } catch (e: ApiError) {
            throw e
        } catch (e: Throwable) {
            throw ApiError.Transport(e)
        }
        return when (resp.status.value) {
            in 200..299 -> resp
            401 -> throw ApiError.Unauthorized
            else -> throw ApiError.HttpError(resp.status.value)
        }
    }

    suspend inline fun <reified T> get(path: String, needsAuth: Boolean = false): T =
        request(HttpMethod.Get, path, null, needsAuth).body()

    suspend inline fun <reified T> post(path: String, body: Any? = null, needsAuth: Boolean = false): T =
        request(HttpMethod.Post, path, body, needsAuth).body()
}
