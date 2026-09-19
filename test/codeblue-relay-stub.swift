// Typecheck-only substitute for the unrelated Capacitor relay. Production owns these
// Notification.Name constants; no data, transport, model or UI is mocked in this check.
import Foundation
enum WatchConnectivityRelay {
    static let codeBlueReset = Notification.Name("codeBlueReset")
    static let codeBlueReceived = Notification.Name("codeBlueReceived")
}
