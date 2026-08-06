package `in`.stewardmd.wear.ui

import com.google.firebase.auth.FirebaseAuth

/** Is a Firebase user signed in on the watch? The token is bridged from the phone (Data Layer). */
object Session {
    fun signedIn(): Boolean = try {
        FirebaseAuth.getInstance().currentUser != null
    } catch (e: Throwable) {
        false
    }

    fun uid(): String? = try {
        FirebaseAuth.getInstance().currentUser?.uid
    } catch (e: Throwable) {
        null
    }
}

/** GHIS ward-session token, pushed by the phone over the Data Layer (/smd/ghis/token). Null = no
 *  active ward session on the watch, so lab fetches show "open the ward on your phone". */
object GhisSession {
    @Volatile
    var token: String? = null
}
