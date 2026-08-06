package `in`.stewardmd.wear.net

import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.tasks.await

/**
 * Bridges the Firebase ID token into [ApiClient] as the Bearer credential. Thin glue over FirebaseAuth
 * (returns null when signed out or on error — the caller then surfaces auth-required). Exercised on
 * device; the message→sign-in logic it depends on is unit-tested in DataLayerAuthTest.
 */
class FirebaseTokenProvider : AuthTokenProvider {
    // FirebaseAuth.getInstance() is resolved lazily INSIDE the call (and guarded) so constructing the
    // provider / ApiClient never touches Firebase — the app shell still launches before google-services.json
    // is provisioned; auth'd calls just return null (surfaced as auth-required) until sign-in works.
    override suspend fun currentToken(): String? = try {
        FirebaseAuth.getInstance().currentUser?.getIdToken(false)?.await()?.token
    } catch (e: Throwable) {
        null
    }
}
