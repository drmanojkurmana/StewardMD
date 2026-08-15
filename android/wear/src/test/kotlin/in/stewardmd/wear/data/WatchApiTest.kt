package `in`.stewardmd.wear.data

import `in`.stewardmd.wear.net.ApiClient
import `in`.stewardmd.wear.net.ApiError
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class WatchApiTest {
    private val jsonHeader = headersOf(HttpHeaders.ContentType, "application/json")

    @Test
    fun statusSendsFirebaseBearerAndParsesWatching() = runTest {
        val engine = MockEngine { req ->
            assertEquals("/api/watch/status", req.url.encodedPath)
            assertEquals("Bearer fb-token", req.headers[HttpHeaders.Authorization])
            respond(
                """{"consented":true,"watching":[{"patientId":"p1","name":"R.K.","bedName":"5"}]}""",
                HttpStatusCode.OK, jsonHeader,
            )
        }
        val w = WatchApi(ApiClient(engine = engine, tokenProvider = { "fb-token" }))
        val s = w.status()
        assertTrue(s.consented)
        assertEquals(1, s.watching.size)
        assertEquals("p1", s.watching[0].patientId)
    }

    @Test
    fun setTaskStatusForbiddenSurfacesAsHttp403() = runTest {
        val engine = MockEngine { respond("""{"ok":false,"error":"forbidden"}""", HttpStatusCode.Forbidden, jsonHeader) }
        val w = WatchApi(ApiClient(engine = engine, tokenProvider = { "fb" }))
        try {
            w.setTaskStatus("g1", "p1", "t1", "complete")
            fail("expected HttpError(403)")
        } catch (e: ApiError.HttpError) {
            assertEquals(403, e.code)
        }
    }

    @Test
    fun codeblueStartPostsEventStart() = runTest {
        val engine = MockEngine { req ->
            assertEquals("/api/watch/codeblue", req.url.encodedPath)
            respond("""{"ok":true,"pushed":1}""", HttpStatusCode.OK, jsonHeader)
        }
        val w = WatchApi(ApiClient(engine = engine, tokenProvider = { "fb" }))
        assertTrue(w.codeblueStart().ok)
    }
}
