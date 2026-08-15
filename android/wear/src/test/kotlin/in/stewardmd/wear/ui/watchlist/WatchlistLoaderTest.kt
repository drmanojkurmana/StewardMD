package `in`.stewardmd.wear.ui.watchlist

import `in`.stewardmd.wear.data.WatchApi
import `in`.stewardmd.wear.net.ApiClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class WatchlistLoaderTest {
    private val json = headersOf(HttpHeaders.ContentType, "application/json")
    private fun loader(engine: MockEngine) = WatchlistLoader(WatchApi(ApiClient(engine = engine, tokenProvider = { "fb" })))

    @Test fun loadedWithWatchedPatients() = runTest {
        val ui = loader(MockEngine {
            respond("""{"consented":true,"watching":[{"patientId":"p1","name":"R.K."}]}""", HttpStatusCode.OK, json)
        }).load()
        assertTrue(ui is WatchlistUi.Loaded)
        assertEquals(1, (ui as WatchlistUi.Loaded).patients.size)
    }

    @Test fun needsProOn402() = runTest {
        val ui = loader(MockEngine { respond("""{"error":"needs-pro"}""", HttpStatusCode.PaymentRequired, json) }).load()
        assertEquals(WatchlistUi.NeedsPro, ui)
    }

    @Test fun signInMessageOn401() = runTest {
        val ui = loader(MockEngine { respond("", HttpStatusCode.Unauthorized) }).load()
        assertTrue(ui is WatchlistUi.Error && (ui as WatchlistUi.Error).msg.contains("Sign in"))
    }
}
