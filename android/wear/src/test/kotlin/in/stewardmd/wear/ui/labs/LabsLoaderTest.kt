package `in`.stewardmd.wear.ui.labs

import `in`.stewardmd.wear.data.WatchApi
import `in`.stewardmd.wear.net.ApiClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LabsLoaderTest {
    private val json = headersOf(HttpHeaders.ContentType, "application/json")
    private fun loader(engine: MockEngine) = LabsLoader(WatchApi(ApiClient(engine = engine, tokenProvider = { "fb" })))

    @Test
    fun needsSignInWhenNotSignedIn() = runTest {
        // status() must NOT be called when signed out.
        val engine = MockEngine { error("network should not be hit when signed out") }
        val ui = loader(engine).load(signedIn = false, wardToken = null)
        assertEquals(LabsUi.NeedsSignIn, ui)
    }

    @Test
    fun loadedWithWardSessionFlag() = runTest {
        val ui = loader(MockEngine {
            respond("""{"consented":true,"watching":[{"patientId":"p1","name":"R.K.","bedName":"3"}]}""", HttpStatusCode.OK, json)
        }).load(signedIn = true, wardToken = "ghis-token")
        assertTrue(ui is LabsUi.Loaded)
        ui as LabsUi.Loaded
        assertTrue(ui.wardSession)
        assertEquals(1, ui.patients.size)
    }

    @Test
    fun loadedButNoWardSessionWhenTokenNull() = runTest {
        val ui = loader(MockEngine { respond("""{"consented":true,"watching":[]}""", HttpStatusCode.OK, json) })
            .load(signedIn = true, wardToken = null)
        assertTrue(ui is LabsUi.Loaded)
        assertFalse((ui as LabsUi.Loaded).wardSession)
    }

    @Test
    fun needsProOn402() = runTest {
        val ui = loader(MockEngine { respond("""{"error":"needs-pro"}""", HttpStatusCode.PaymentRequired, json) })
            .load(signedIn = true, wardToken = "t")
        assertEquals(LabsUi.NeedsPro, ui)
    }
}
