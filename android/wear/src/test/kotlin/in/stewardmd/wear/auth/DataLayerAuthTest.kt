package `in`.stewardmd.wear.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DataLayerAuthTest {

    private class FakeAuth : WatchAuth {
        var lastToken: String? = null
        override val currentUid: String? get() = if (lastToken != null) "uid-1" else null
        override fun signInWithGoogleIdToken(idToken: String) { lastToken = idToken }
    }

    @Test
    fun credentialMessageSignsIn() {
        val auth = FakeAuth()
        val bridge = DataLayerAuth(auth)
        val handled = bridge.onMessage(DataLayerAuth.PATH_CREDENTIAL, """{"idToken":"g-id-token"}""".toByteArray())
        assertTrue(handled)
        assertEquals("g-id-token", auth.lastToken)
        assertEquals("uid-1", auth.currentUid)
    }

    @Test
    fun ignoresOtherPaths() {
        val auth = FakeAuth()
        val bridge = DataLayerAuth(auth)
        assertFalse(bridge.onMessage("/smd/other", """{"idToken":"x"}""".toByteArray()))
        assertNull(auth.lastToken)
    }

    @Test
    fun ignoresMalformedOrEmptyCredential() {
        val auth = FakeAuth()
        val bridge = DataLayerAuth(auth)
        assertFalse(bridge.onMessage(DataLayerAuth.PATH_CREDENTIAL, "not json".toByteArray()))
        assertFalse(bridge.onMessage(DataLayerAuth.PATH_CREDENTIAL, "{}".toByteArray()))
        assertNull(auth.lastToken)
    }
}
