import Foundation
import StewardMDWatchCore

/// Process-wide singletons shared by the app UI and the notification handler, so
/// an acknowledge from a Long Look and one from the app hit the same queue and
/// the same authenticated networking stack.
enum WatchServices {
    static let store = AppGroupStore()
    static let apiClient = APIClient(tokenProvider: BridgedTokenProvider(store: store))
    static let drugAPI = DrugAPI(client: apiClient)
    static let appAPI = AppAPI(client: apiClient)

    /// Acks sync to the backend (`POST /api/watch/ack`) and retry on failure.
    static let ackQueue = AckQueue(store: UserDefaultsAckStore(), sender: HTTPAckSender(api: appAPI))

    /// Running app version, for the min-version gate.
    static var appVersion: String {
        (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "2.0"
    }
}
