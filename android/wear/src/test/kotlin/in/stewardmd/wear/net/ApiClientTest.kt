package `in`.stewardmd.wear.net

import `in`.stewardmd.wear.model.WatchStatus
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.fail
import org.junit.Test

class ApiClientTest {

    @Test
    fun attachesBearerAndMaps401() = runTest {
        val engine = MockEngine { req ->
            assertEquals("Bearer tok123", req.headers[HttpHeaders.Authorization])
            respond("", HttpStatusCode.Unauthorized)
        }
        val api = ApiClient(engine = engine, tokenProvider = { "tok123" })
        try {
            api.get<Unit>(Endpoints.WATCH_STATUS, needsAuth = true)
            fail("expected ApiError.Unauthorized")
        } catch (e: ApiError.Unauthorized) {
            // expected
        }
    }

    @Test
    fun noAuthHeaderAndDeserializesWhenNotNeeded() = runTest {
        val engine = MockEngine { req ->
            assertNull(req.headers[HttpHeaders.Authorization])
            respond(
                """{"consented":false,"watching":[],"extra":"ignored"}""",
                HttpStatusCode.OK,
                headersOf(HttpHeaders.ContentType, "application/json"),
            )
        }
        val api = ApiClient(engine = engine, tokenProvider = { "tok" })
        val s = api.get<WatchStatus>(Endpoints.WATCH_STATUS, needsAuth = false)
        assertFalse(s.consented)
    }

    @Test
    fun mapsOtherErrorsToHttpError() = runTest {
        val engine = MockEngine { respond("nope", HttpStatusCode.InternalServerError) }
        val api = ApiClient(engine = engine, tokenProvider = { null })
        try {
            api.get<Unit>(Endpoints.WATCH_STATUS, needsAuth = true)
            fail("expected ApiError.HttpError")
        } catch (e: ApiError.HttpError) {
            assertEquals(500, e.code)
        }
    }
}
