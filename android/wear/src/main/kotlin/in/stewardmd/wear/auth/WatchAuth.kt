package `in`.stewardmd.wear.auth

import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.GoogleAuthProvider

/** Abstraction over Firebase Auth so the Data Layer bridge is unit-testable without Firebase. */
interface WatchAuth {
    val currentUid: String?
    fun signInWithGoogleIdToken(idToken: String)
}

/** Real implementation — signs the watch into Firebase with the Google ID token bridged from the phone. */
class FirebaseWatchAuth(
    private val auth: FirebaseAuth = FirebaseAuth.getInstance(),
) : WatchAuth {
    override val currentUid: String? get() = auth.currentUser?.uid
    override fun signInWithGoogleIdToken(idToken: String) {
        auth.signInWithCredential(GoogleAuthProvider.getCredential(idToken, null))
    }
}
