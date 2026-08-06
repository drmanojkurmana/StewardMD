package `in`.stewardmd.wear.ui

import `in`.stewardmd.wear.data.DrugApi
import `in`.stewardmd.wear.data.GhisApi
import `in`.stewardmd.wear.data.IcuRepository
import `in`.stewardmd.wear.data.WatchApi
import `in`.stewardmd.wear.net.ApiClient
import `in`.stewardmd.wear.net.FirebaseTokenProvider
import com.google.firebase.firestore.FirebaseFirestore

/**
 * Tiny hand-rolled DI (ponytail: no framework for one graph). Firebase-dependent pieces are lazy +
 * guarded so the app launches even before google-services.json is provisioned.
 */
class AppContainer {
    private val api: ApiClient by lazy { ApiClient(tokenProvider = FirebaseTokenProvider()) }
    val watch: WatchApi by lazy { WatchApi(api) }
    val ghis: GhisApi by lazy { GhisApi(api) }
    val drug: DrugApi by lazy { DrugApi(api) }
    val icu: IcuRepository? by lazy { runCatching { IcuRepository(FirebaseFirestore.getInstance()) }.getOrNull() }
}
