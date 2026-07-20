import Foundation
import StewardMDWatchCore

/// Process-wide singletons shared by the app UI, the notification handler, and
/// the WatchConnectivity receiver — so an acknowledge from a Long Look and one
/// from the app hit the same queue, and a push received in the background feeds
/// the same models the UI renders.
enum WatchServices {
    static let store = AppGroupStore()
    static let apiClient = APIClient(tokenProvider: BridgedTokenProvider(store: store))
    static let drugAPI = DrugAPI(client: apiClient)
    static let appAPI = AppAPI(client: apiClient)

    /// Acks sync to the backend (`POST /api/watch/ack`) and retry on failure.
    static let ackQueue = AckQueue(store: UserDefaultsAckStore(), sender: HTTPAckSender(api: appAPI))

    /// Shared clinical models (populated by pushes + the WC relay, rendered by the UI).
    @MainActor static let labs = CriticalLabsModel(ackQueue: ackQueue)
    @MainActor static let watchlist = WatchlistModel()
    @MainActor static let tasks = TasksModel()

    /// Running app version, for the min-version gate.
    static var appVersion: String {
        (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "2.0"
    }
}
