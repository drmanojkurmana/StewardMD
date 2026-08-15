package `in`.stewardmd.wear.auth

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
private data class Credential(val idToken: String? = null)

/**
 * Watch-side of the phone→watch auth bridge (D1). The phone pushes the Firebase Google ID token over
 * the Wearable Data Layer on [PATH_CREDENTIAL]; this signs the watch into Firebase so every later
 * Firestore read + Bearer REST call authenticates as the same uid as the phone.
 *
 * Pure message→action logic (no Android/Firebase deps) so it is unit-testable; the real wiring is a
 * MessageClient.OnMessageReceivedListener that calls [onMessage], and the phone producer
 * (WearableListenerService in the :app module) — both are device-integration (deferred).
 */
class DataLayerAuth(
    private val auth: WatchAuth,
    private val json: Json = Json { ignoreUnknownKeys = true },
) {
    companion object {
        const val PATH_CREDENTIAL = "/smd/auth/credential"   // phone → watch: Google ID token
        const val PATH_REFRESH = "/smd/auth/refresh"         // watch → phone: request a fresh token
        const val PATH_GHIS_TOKEN = "/smd/ghis/token"        // phone → watch: current GHIS session token
    }

    /** Returns true iff the message was a valid auth credential that triggered sign-in. */
    fun onMessage(path: String, data: ByteArray): Boolean {
        if (path != PATH_CREDENTIAL) return false
        val token = try {
            json.decodeFromString<Credential>(data.decodeToString()).idToken
        } catch (e: Throwable) {
            null
        } ?: return false
        auth.signInWithGoogleIdToken(token)
        return true
    }
}
