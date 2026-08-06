package `in`.stewardmd.wear.net

import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.tasks.await

/**
 * Bridges the Firebase ID token into [ApiClient] as the Bearer credential. Thin glue over FirebaseAuth
 * (returns null when signed out or on error — the caller then surfaces auth-required). Exercised on
 * device; the message→sign-in logic it depends on is unit-tested in DataLayerAuthTest.
 */
class FirebaseTokenProvider(
    private val auth: FirebaseAuth = FirebaseAuth.getInstance(),
) : AuthTokenProvider {
    override suspend fun currentToken(): String? = try {
        auth.currentUser?.getIdToken(false)?.await()?.token
    } catch (e: Throwable) {
        null
    }
}
