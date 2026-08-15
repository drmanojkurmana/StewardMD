package `in`.stewardmd.wear.ui.watchlist

import `in`.stewardmd.wear.data.WatchApi
import `in`.stewardmd.wear.model.Patient
import `in`.stewardmd.wear.net.ApiError

sealed interface WatchlistUi {
    data object Loading : WatchlistUi
    data class Loaded(val patients: List<Patient>, val consented: Boolean) : WatchlistUi
    data object NeedsPro : WatchlistUi
    data class Error(val msg: String) : WatchlistUi
}

/** Pure state loader for the watchlist screen (unit-tested). Maps API errors to honest UI states. */
class WatchlistLoader(private val watch: WatchApi) {
    suspend fun load(): WatchlistUi = try {
        val s = watch.status()
        WatchlistUi.Loaded(s.watching, s.consented)
    } catch (e: ApiError.HttpError) {
        if (e.code == 402) WatchlistUi.NeedsPro else WatchlistUi.Error("Error ${e.code}")
    } catch (e: ApiError.Unauthorized) {
        WatchlistUi.Error("Sign in on your phone")
    } catch (e: Throwable) {
        WatchlistUi.Error("Offline")
    }
}
