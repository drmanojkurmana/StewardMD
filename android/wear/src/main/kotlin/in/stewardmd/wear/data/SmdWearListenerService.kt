package `in`.stewardmd.wear.data

import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService
import `in`.stewardmd.wear.auth.DataLayerAuth
import `in`.stewardmd.wear.ui.GhisSession

/**
 * Receives Data Layer messages from the phone. Path A auth is on-watch, so the only thing bridged is
 * the GHIS ward-session token (which lives only in the phone's web layer) — stored for the Labs screen.
 * Manifest-declared so it wakes the app even when backgrounded.
 */
class SmdWearListenerService : WearableListenerService() {
    override fun onMessageReceived(event: MessageEvent) {
        when (event.path) {
            DataLayerAuth.PATH_GHIS_TOKEN -> GhisSession.token = String(event.data).ifBlank { null }
        }
    }
}
