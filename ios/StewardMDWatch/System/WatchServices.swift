import Foundation
import StewardMDWatchCore

/// Process-wide singletons shared by the app UI and the notification handler, so
/// an acknowledge from a Long Look and one from the app hit the same queue.
enum WatchServices {
    static let ackQueue = AckQueue()
}
