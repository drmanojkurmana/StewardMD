import Foundation

/// Supplies the current Firebase ID token for authenticated requests. On the
/// watch this is backed by the bridged session (App Group / WCSession) and can
/// request a refresh from the phone when the token is stale.
public protocol AuthTokenProvider: Sendable {
    func currentToken() async -> String?
}
